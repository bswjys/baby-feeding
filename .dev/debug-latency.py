#!/usr/bin/env python3
"""실제 Firebase 연결·병합 지연 시간 측정 (디버그용)."""
import time
from playwright.sync_api import sync_playwright

APP = 'http://127.0.0.1:8765/index.html'
RURL = 'https://baby-feeding-9f820-default-rtdb.asia-southeast1.firebasedatabase.app'
room = 'dbg-' + str(int(time.time()))[-6:]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    C = ctx.new_page()
    C.on('console', lambda m: print('C', m.type, m.text[:200]))
    C.goto(APP)
    C.wait_for_timeout(300)
    C.click('#whoDad'); C.click('#bottleBtn')
    C.wait_for_timeout(150)
    C.click('#whoMom'); C.click('#amountBox')
    C.wait_for_timeout(200)
    t0 = time.time()
    C.click('#sharePill'); C.wait_for_selector('#shareSheet:not([hidden])')
    C.fill('#roomInput', room); C.click('#shareSave')
    C.wait_for_function("document.getElementById('sharePill').dataset.mode === 'live'", timeout=20000)
    print('live after %.2fs' % (time.time() - t0))
    for i in range(20):
        d = C.evaluate("fetch('%s/rooms/%s/records.json').then(r=>r.text())" % (RURL, room.upper()))
        print('%.2fs ->' % (time.time() - t0), d[:120])
        if d and d != 'null':
            break
        C.wait_for_timeout(300)
    C.wait_for_timeout(300)

    D = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    t1 = time.time()
    D.goto(APP + '?room=' + room)
    D.wait_for_function("document.querySelectorAll('#recordList .row').length === 2", timeout=25000)
    print('D got 2 rows after %.2fs' % (time.time() - t1))
    C.evaluate("fetch('%s/rooms/%s.json', {method:'DELETE'})" % (RURL, room.upper()))
    C.wait_for_timeout(400)
    print('cleanup ->', C.evaluate("fetch('%s/rooms/%s.json').then(r=>r.text())" % (RURL, room.upper())))
    b.close()
