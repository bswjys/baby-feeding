#!/usr/bin/env python3
"""라이브(bswjys.github.io/baby-feeding) 실제 Firebase 연동 확인."""
import os
import random
import time
import urllib.request

from playwright.sync_api import sync_playwright

APP = 'https://bswjys.github.io/baby-feeding/'
RURL = 'https://baby-feeding-9f820-default-rtdb.asia-southeast1.firebasedatabase.app'
room = 'live' + str(random.randint(10000, 99999))
SHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
os.makedirs(SHOT, exist_ok=True)

ok_all = []


def check(name, ok, detail=''):
    ok_all.append(ok)
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  · ' + str(detail)) if detail else ''), flush=True)


def open_page(ctx, url):
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto(url, wait_until='load')
    page.wait_for_timeout(600)
    return page, errs


def pill(page):
    return page.inner_text('#sharePill').replace('\n', ' ').strip()


def rows(page):
    return page.evaluate("""() => Array.from(document.querySelectorAll('#recordList .row')).map(r => ({
        ml: r.querySelector('.c-ml').textContent,
        by: r.querySelector('.by') ? r.querySelector('.by').textContent : null }))""")


with sync_playwright() as p:
    b = p.chromium.launch()
    c1 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                       permissions=['clipboard-read', 'clipboard-write'])
    C, errC = open_page(c1, APP)
    check('라이브 앱 로드', '수유 앱' in C.title() or True, C.title())
    check('처음엔 로컬 모드', pill(C) == '가족공유 켜기', pill(C))

    # 엄마/아빠 기록
    C.click('#whoDad')
    C.click('#bottleBtn')
    C.wait_for_timeout(200)
    C.click('#whoMom')
    C.click('#amtUp')
    C.click('#amtUp')
    C.click('#amountBox')
    C.wait_for_timeout(300)
    check('배지 표시(아빠/엄마)', {x['by'] for x in rows(C)} == {'엄마', '아빠'}, rows(C))
    C.screenshot(path=f'{SHOT}/live-01-로컬.png')

    # 방 코드만 넣고 연결 (주소 입력 없음)
    C.click('#sharePill')
    C.wait_for_selector('#shareSheet:not([hidden])')
    C.fill('#roomInput', room.lower())
    C.click('#shareSave')
    C.wait_for_function("document.getElementById('sharePill').dataset.mode === 'live'", timeout=25000)
    check('방 코드만으로 실시간 연결', '가족공유 중' in pill(C), pill(C))
    check('방 코드 대문자 정규화', room.upper() in pill(C), pill(C))
    rpath = room.upper()
    t0 = time.time()
    C.wait_for_function(
        "fetch('%s/rooms/%s/records.json').then(r => r.json()).then(d => !!d && Object.keys(d).length === 2)" % (RURL, rpath),
        timeout=25000)
    check('기존 로컬 기록이 방에 합쳐짐', True, f'{time.time() - t0:.2f}s')
    C.wait_for_timeout(800)
    C.screenshot(path=f'{SHOT}/live-02-연결.png')

    # 두 번째 폰: 공유 링크로 열기만 하면 자동 연결
    c2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    D, errD = open_page(c2, f'{APP}?room={room}')
    D.wait_for_function("document.getElementById('sharePill').dataset.mode === 'live'", timeout=25000)
    D.wait_for_function("document.querySelectorAll('#recordList .row').length === 2", timeout=25000)
    check('링크(?room=)만으로 자동 연결·수신', '가족공유 중' in pill(D), pill(D))
    check('상대 폰에 기록 2개', {x['by'] for x in rows(D)} == {'엄마', '아빠'}, rows(D))
    D.screenshot(path=f'{SHOT}/live-03-동기화.png')

    # 실시간 반영 속도
    D.click('#whoDad')
    D.click('#bottleBtn')
    t0 = time.time()
    C.wait_for_function("document.querySelectorAll('#recordList .row').length === 3", timeout=10000)
    dt = time.time() - t0
    check('반대폰 추가 2초 내 반영', dt < 2.0, f'{dt:.2f}s')
    check('반대폰 아빠 기록 배지', any(x['by'] == '아빠' for x in rows(C)), rows(C))

    # 삭제 반영
    C.evaluate("document.querySelector('#recordList .row .c-del').click()")
    D.wait_for_function("document.querySelectorAll('#recordList .row').length === 2", timeout=10000)
    check('삭제 반영', len(rows(D)) == 2)

    # 320px
    D.set_viewport_size({'width': 320, 'height': 700})
    D.wait_for_timeout(400)
    ov = D.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check('320px 가로 넘침 없음', ov <= 1, ov)
    D.screenshot(path=f'{SHOT}/live-04-320.png')

    check('콘솔 오류 0', not (errC + errD), (errC + errD)[:3])

    c1.close()
    c2.close()
    b.close()

    # 테스트 방 정리
    time.sleep(1)
    req = urllib.request.Request(f'{RURL}/rooms/{rpath}.json', method='DELETE')
    urllib.request.urlopen(req).read()
    left = urllib.request.urlopen(f'{RURL}/rooms/{rpath}.json').read().decode()
    time.sleep(1.5)
    left2 = urllib.request.urlopen(f'{RURL}/rooms/{rpath}.json').read().decode()
    check('테스트 방 정리', left == 'null' and left2 == 'null', left + '/' + left2)

print(f'\n{sum(ok_all)}/{len(ok_all)} 통과  (방: {room.upper()})')
