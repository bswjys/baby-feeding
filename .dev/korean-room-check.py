#!/usr/bin/env python3
"""한글 방 코드('우리집') 실제 Firebase 확인."""
import time
import urllib.request
from urllib.parse import quote

from playwright.sync_api import sync_playwright

APP = 'https://bswjys.github.io/baby-feeding/'
RURL = 'https://baby-feeding-9f820-default-rtdb.asia-southeast1.firebasedatabase.app'
room = '우리집'
enc = quote(room)

ok = []


def check(name, cond, detail=''):
    ok.append(cond)
    print(('PASS  ' if cond else 'FAIL  ') + name + ((' · ' + str(detail)) if detail else ''), flush=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    c1 = b.new_context(viewport={'width': 390, 'height': 844})
    C = c1.new_page()
    C.on('pageerror', lambda e: print('PAGEERROR', e))
    C.goto(APP)
    C.wait_for_timeout(500)
    C.click('#whoDad')
    C.click('#bottleBtn')
    C.wait_for_timeout(200)
    C.click('#sharePill')
    C.wait_for_selector('#shareSheet:not([hidden])')
    C.fill('#roomInput', '우리 집')
    C.click('#shareSave')
    C.wait_for_function("document.getElementById('sharePill').dataset.mode === 'live'", timeout=25000)
    check('한글 방 코드 연결', '가족공유 중' in C.inner_text('#sharePill'), C.inner_text('#sharePill').replace('\n', ' '))
    check('공백 제거된 코드', '우리집' in C.inner_text('#sharePill'), C.inner_text('#sharePill').replace('\n', ' '))
    C.wait_for_function(
        "fetch('%s/rooms/%s/records.json').then(r => r.json()).then(d => !!d && Object.keys(d).length === 1)" % (RURL, enc),
        timeout=25000)
    check('한글 방 경로에 저장됨', True)

    c2 = b.new_context(viewport={'width': 390, 'height': 844})
    D = c2.new_page()
    D.goto(APP + '?room=' + quote(room))
    D.wait_for_function("document.getElementById('sharePill').dataset.mode === 'live'", timeout=25000)
    D.wait_for_function("document.querySelectorAll('#recordList .row').length === 1", timeout=20000)
    check('한글 링크로 자동 연결·수신', True, D.inner_text('#sharePill').replace('\n', ' '))

    c1.close()
    c2.close()
    b.close()

    time.sleep(1)
    urllib.request.urlopen(urllib.request.Request(f'{RURL}/rooms/{enc}.json', method='DELETE')).read()
    left = urllib.request.urlopen(f'{RURL}/rooms/{enc}.json').read().decode()
    check('한글 방 정리', left == 'null', left)

print(f'{sum(ok)}/{len(ok)}')
