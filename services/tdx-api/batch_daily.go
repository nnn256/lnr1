package main

import (
	"encoding/json"
	"fmt"
	"github.com/injoyai/tdx"
	"github.com/injoyai/tdx/protocol"
	"net/http"
	"regexp"
	"sort"
	"sync"
	"time"
)

// Independent connections avoid concurrent same-command responses on one TDX socket.
var dailySlots = make(chan struct{}, 4)
var dailyConnections = make(chan *tdx.Client, 4)
var stockCodePattern = regexp.MustCompile(`^(sh|sz|bj)[0-9]{6}$`)

type dailyOutcome struct {
	Code  string            `json:"code"`
	List  []*protocol.Kline `json:"list,omitempty"`
	Error string            `json:"error,omitempty"`
}

func boundedDaily(code string, count int) (result dailyOutcome) {
	result.Code = code
	dailySlots <- struct{}{}
	defer func() { <-dailySlots }()
	var conn *tdx.Client
	var err error
	select {
	case conn = <-dailyConnections:
	default:
		conn, err = tdx.Dial(selectedQuoteHost, tdx.WithDebug(false))
	}
	if err != nil {
		result.Error = err.Error()
		return
	}
	conn.Wait.SetTimeout(5 * time.Second)
	healthy := false
	defer func() {
		if healthy {
			dailyConnections <- conn
		} else {
			conn.Close()
		}
	}()
	for offset := 0; offset < count; offset += 800 {
		n := count - offset
		if n > 800 {
			n = 800
		}
		page, e := conn.GetKlineDay(code, uint16(offset), uint16(n))
		if e != nil {
			result.List = nil
			result.Error = e.Error()
			return
		}
		result.List = append(result.List, page.List...)
		if len(page.List) < n {
			break
		}
	}
	sort.Slice(result.List, func(i, j int) bool { return result.List[i].Time.Before(result.List[j].Time) })
	healthy = true
	return
}

func handleBatchDaily(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorResponse(w, "POST required")
		return
	}
	var request struct {
		Codes []string `json:"codes"`
		Count int      `json:"count"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&request); err != nil {
		errorResponse(w, "invalid request")
		return
	}
	if len(request.Codes) < 1 || len(request.Codes) > 24 || request.Count < 100 || request.Count > 2400 {
		errorResponse(w, "requires 1..24 stocks and 100..2400 bars")
		return
	}
	for _, code := range request.Codes {
		if !stockCodePattern.MatchString(code) {
			errorResponse(w, fmt.Sprintf("invalid code %s", code))
			return
		}
	}
	result := make([]dailyOutcome, len(request.Codes))
	var wg sync.WaitGroup
	for i, code := range request.Codes {
		wg.Add(1)
		go func(i int, code string) { defer wg.Done(); result[i] = boundedDaily(code, request.Count) }(i, code)
	}
	wg.Wait()
	successResponse(w, result)
}
