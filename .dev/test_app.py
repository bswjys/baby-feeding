#!/usr/bin/env python3
"""수유 앱 (엄마·아빠 실시간 공유) Playwright 검증."""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

APP = 'http://127.0.0.1:8765/index.html'
DB = 'http://127.0.0.1:8766'
SHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
os.makedirs(SHOT, exist_ok=True)

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  · ' + str(detail)) if detail else ''), flush=True)


def new_page(browser, width=390):
    ctx = browser.new_context(viewport={'width': width, 'height': 844},
                              device_scale_factor=2,
                              permissions=['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('dialog', lambda d: d.accept())
    return ctx, page, errs


def overflow(page):
    return page.evaluate("""() => {
        const de = document.documentElement;
        const out = [];
        if (de.scrollWidth > window.innerWidth + 1) out.push('html ' + de.scrollWidth + '>' + window.innerWidth);
        document.querySelectorAll('body *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
                const id = el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName;
                out.push(id + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            }
        });
        return out.slice(0, 8);
    }""")


def status_text(page):
    return page.inner_text('#sharePill').strip()


def rows(page):
    return page.evaluate("""() => Array.from(document.querySelectorAll('#recordList .row')).map(r => ({
        ml: r.querySelector('.c-ml').textContent,
        time: r.querySelector('.c-time').textContent,
        by: r.querySelector('.by') ? r.querySelector('.by').textContent : null,
        id: r.dataset.id
    }))""")


def connect_room(page, url, room, wait=True):
    page.click('#sharePill')
    page.wait_for_selector('#shareSheet:not([hidden])')
    if url is not None:
        page.evaluate("document.getElementById('advBox').open = true")
        page.fill('#dbInput', url)
    page.fill('#roomInput', room)
    page.click('#shareSave')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ─────────── 1. 로컬 모드 ───────────
        ctx, page, errs = new_page(browser, 390)
        page.goto(APP)
        page.wait_for_timeout(400)
        check('로컬 모드: 상태 뱃지 표기', status_text(page) == '로컬 저장 모드', status_text(page))
        check('로컬 모드: 초기 기록 0개', len(rows(page)) == 0)
        check('기록자 기본값 = 엄마', page.get_attribute('#whoMom', 'aria-pressed') == 'true')
        page.screenshot(path=f'{SHOT}/local-01-초기.png')

        # 아빠로 전환 → 젖병 기록
        page.click('#whoDad')
        page.wait_for_timeout(200)
        check('아빠 토글 pressed', page.get_attribute('#whoDad', 'aria-pressed') == 'true'
              and page.get_attribute('#whoMom', 'aria-pressed') == 'false')
        page.click('#bottleBtn')
        page.wait_for_timeout(250)
        r = rows(page)
        check('아빠 기록 저장 + 배지', len(r) == 1 and r[0]['by'] == '아빠' and r[0]['ml'] == '60ml', r)
        check('아빠 배지 색 클래스', page.evaluate("!!document.querySelector('.row .by-dad')"))

        # 엄마로 전환 → 수유량 박스 기록
        page.click('#whoMom')
        page.wait_for_timeout(150)
        page.click('#amtUp')
        page.click('#amtUp')
        page.click('#amountBox')
        page.wait_for_timeout(250)
        r = rows(page)
        check('엄마 기록 + 배지', len(r) == 2 and r[0]['by'] == '엄마' and r[0]['ml'] == '80ml', r)
        check('오늘 합계', '오늘 2회 · 140ml' in page.inner_text('#todaySum'), page.inner_text('#todaySum'))
        page.screenshot(path=f'{SHOT}/local-02-기록.png')

        # 편집 시트에 기록자 표시
        page.click('#recordList .row:first-child')
        page.wait_for_selector('#sheet:not([hidden])')
        check('수정 시트에 기록자 표시', '엄마' in page.inner_text('#sheetTitle'), page.inner_text('#sheetTitle'))
        page.click('#editCancel')

        # 새로고침 후 유지
        page.reload()
        page.wait_for_timeout(500)
        r = rows(page)
        check('새로고침 후 기록 유지', len(r) == 2)
        check('새로고침 후 기록자 선택 유지(엄마)', page.get_attribute('#whoMom', 'aria-pressed') == 'true')

        # 가로 넘침 (390 / 320)
        ov = overflow(page)
        check('390px 가로 넘침 없음', not ov, ov)
        page.click('#sharePill')
        page.wait_for_selector('#shareSheet:not([hidden])')
        page.wait_for_timeout(250)
        check('공유 시트 기본 상태(주소 접힘)', not page.evaluate("document.getElementById('advBox').open"))
        page.screenshot(path=f'{SHOT}/local-04-공유시트.png')
        ov = overflow(page)
        check('390px 공유 시트 넘침 없음', not ov, ov)
        page.click('#shareCancel')
        page.wait_for_timeout(150)
        page.set_viewport_size({'width': 320, 'height': 700})
        page.wait_for_timeout(250)
        ov = overflow(page)
        check('320px 가로 넘침 없음', not ov, ov)
        page.screenshot(path=f'{SHOT}/local-03-320.png')

        # 공유 시트도 320px 확인
        page.click('#sharePill')
        page.wait_for_selector('#shareSheet:not([hidden])')
        page.evaluate("document.getElementById('advBox').open = true")
        page.wait_for_timeout(250)
        ov = overflow(page)
        check('320px 공유 시트 넘침 없음', not ov, ov)
        page.screenshot(path=f'{SHOT}/share-01-320.png')
        page.click('#shareCancel')
        page.wait_for_timeout(150)

        check('로컬 모드 콘솔 오류 0', not errs, errs)
        ctx.close()

        # ─────────── 2. 실시간 공유 (모의 Firebase) ───────────
        ctxA, A, errsA = new_page(browser, 390)
        ctxB, B, errsB = new_page(browser, 390)
        A.goto(APP)
        A.wait_for_timeout(300)
        B.goto(APP)
        B.wait_for_timeout(300)

        # A = 엄마 폰: 공유를 켜기 전에 이미 기록 2개가 있음
        A.click('#whoDad')
        A.click('#bottleBtn')
        A.wait_for_timeout(150)
        A.click('#whoMom')
        A.click('#amtUp')
        A.click('#amtUp')
        A.click('#amountBox')
        A.wait_for_timeout(250)
        check('A 사전 기록 2개', len(rows(A)) == 2, rows(A))

        # A = 엄마 폰
        connect_room(A, DB, 'MOM123')
        A.wait_for_timeout(1800)
        check('A 연결: 실시간 상태', '실시간 연결됨' in status_text(A), status_text(A))
        check('A 연결: 방 코드 표기', 'MOM123' in A.inner_text('#sharePill'), A.inner_text('#sharePill'))
        check('A 연결: 기록이 방으로 올라감',
              A.evaluate("fetch('%s/__dump').then(r => r.json()).then(d => Object.keys((d.MOM123) || {}).length)" % DB) == 2)
        A.screenshot(path=f'{SHOT}/share-02-A-연결.png')

        # B = 아빠 폰 (새 기기)
        connect_room(B, DB, 'MOM123')
        B.wait_for_timeout(1800)
        check('B 연결: 실시간 상태', '실시간 연결됨' in status_text(B), status_text(B))
        rb = rows(B)
        check('B가 A의 기록 2개를 받음', len(rb) == 2 and {x['by'] for x in rb} == {'엄마', '아빠'}, rb)
        B.screenshot(path=f'{SHOT}/share-03-B-동기화.png')

        # A(아빠로 전환)에서 새 기록 → B에 1~2초 내 반영
        A.click('#whoDad')
        A.click('#bottleBtn')
        t0 = time.time()
        B.wait_for_function("document.querySelectorAll('#recordList .row').length === 3", timeout=5000)
        dt = time.time() - t0
        rb = rows(B)
        check('A 기록 → B 2초 내 반영', dt < 2.0, f'{dt:.2f}s')
        check('B에 아빠 기록 3번째', any(x['by'] == '아빠' and x['ml'] == '60ml' for x in rb), rb)

        # B에서 삭제 → A 반영
        B.evaluate("document.querySelector('#recordList .row .c-del').click()")
        A.wait_for_function("document.querySelectorAll('#recordList .row').length === 2", timeout=5000)
        check('B 삭제 → A 반영', len(rows(A)) == 2, len(rows(A)))

        # A에서 수정 → B 반영
        A.click('#recordList .row:first-child')
        A.wait_for_selector('#sheet:not([hidden])')
        A.fill('#editMl', '150')
        A.click('#editSave')
        B.wait_for_function(
            "Array.from(document.querySelectorAll('#recordList .c-ml')).some(e => e.textContent === '150ml')",
            timeout=5000)
        check('A 수정 → B 반영', True)

        # 오프라인 기록 → localStorage 보관 → 복귀 시 동기화
        ctxA.set_offline(True)
        A.wait_for_timeout(600)
        check('오프라인 상태 표기', '오프라인' in status_text(A), status_text(A))
        A.click('#amountBox')
        A.wait_for_timeout(300)
        check('오프라인에도 기록 저장', len(rows(A)) == 3, len(rows(A)))
        A.screenshot(path=f'{SHOT}/share-04-오프라인.png')
        ctxA.set_offline(False)
        B.wait_for_function("document.querySelectorAll('#recordList .row').length === 3", timeout=12000)
        check('온라인 복귀 후 자동 동기화', len(rows(B)) == 3, len(rows(B)))
        check('복귀 후 실시간 상태', '실시간 연결됨' in status_text(A), status_text(A))

        # B 새로고침 → 설정 유지 + 재연결
        B.reload()
        B.wait_for_timeout(1600)
        check('B 새로고침 후 방 설정 유지', '실시간 연결됨' in status_text(B) and 'MOM123' in B.inner_text('#sharePill'),
              status_text(B))
        check('B 새로고침 후 기록 3개', len(rows(B)) == 3, len(rows(B)))

        ov = overflow(A)
        check('공유 중 390px 넘침 없음', not ov, ov)
        A.set_viewport_size({'width': 320, 'height': 700})
        A.wait_for_timeout(250)
        ov = overflow(A)
        check('공유 중 320px 넘침 없음', not ov, ov)
        A.screenshot(path=f'{SHOT}/share-05-320-연결.png')

        # 공유 끄기
        A.click('#sharePill')
        A.wait_for_selector('#shareSheet:not([hidden])')
        A.click('#shareLeave')
        A.wait_for_timeout(500)
        check('공유 끄면 로컬 모드', status_text(A) == '로컬 저장 모드', status_text(A))
        check('공유 꺼도 기록 유지', len(rows(A)) == 3, len(rows(A)))

        errs = errsA + errsB
        check('공유 모드 콘솔 오류 0', not errs, errs)

        ctxA.close()
        ctxB.close()

        # ─────────── 3. 실제 Firebase (기본 주소) ───────────
        import random
        room = 'tst' + str(random.randint(100000, 999999))
        ctxC, C, errsC = new_page(browser, 390)
        ctxD, D, errsD = new_page(browser, 390)
        C.goto(APP)
        C.wait_for_timeout(300)
        D.goto(APP)
        D.wait_for_timeout(300)

        # C: 공유 전에 로컬 기록 2개 (합쳐지는지 확인)
        C.click('#whoDad')
        C.click('#bottleBtn')
        C.wait_for_timeout(150)
        C.click('#whoMom')
        C.click('#amountBox')
        C.wait_for_timeout(250)

        # 기본 주소이므로 방 코드만 넣으면 연결
        C.click('#sharePill')
        C.wait_for_selector('#shareSheet:not([hidden])')
        C.fill('#roomInput', room)
        C.click('#shareSave')
        C.wait_for_function("'실시간 연결됨' === document.getElementById('sharePill').innerText.split('\\n')[0]", timeout=20000)
        check('실제 Firebase: 실시간 연결됨', '실시간 연결됨' in status_text(C), status_text(C))

        RURL = 'https://baby-feeding-9f820-default-rtdb.asia-southeast1.firebasedatabase.app'
        rpath = room.upper()
        t0 = time.time()
        C.wait_for_function(
            "fetch('%s/rooms/%s/records.json').then(r => r.json()).then(d => !!d && Object.keys(d).length === 2)"
            % (RURL, rpath), timeout=20000)
        merge_dt = time.time() - t0
        check('실제 Firebase: 기존 로컬 기록 2개가 방에 합쳐짐', True, f'연결 후 {merge_dt:.2f}s')
        C.screenshot(path=f'{SHOT}/real-01-연결.png')

        # D: 아빠 폰 — 공유 링크(?room=) 로 열기만 해도 자동 연결
        D.goto(APP + '?room=' + room)
        D.wait_for_function("'실시간 연결됨' === document.getElementById('sharePill').innerText.split('\\n')[0]", timeout=20000)
        D.wait_for_timeout(1200)
        check('링크(?room=)로 자동 연결', '실시간 연결됨' in status_text(D), status_text(D))
        rd = rows(D)
        check('실제 Firebase: 상대 폰이 기록 2개 수신', len(rd) == 2 and {x['by'] for x in rd} == {'엄마', '아빠'}, rd)
        D.screenshot(path=f'{SHOT}/real-02-동기화.png')

        # C에서 기록 추가 → D 2초 내 반영
        C.click('#whoDad')
        C.click('#bottleBtn')
        t0 = time.time()
        D.wait_for_function("document.querySelectorAll('#recordList .row').length === 3", timeout=8000)
        dt = time.time() - t0
        check('실제 Firebase: 기록 추가 2초 내 반영', dt < 2.0, f'{dt:.2f}s')

        # D에서 삭제 → C 반영
        D.evaluate("document.querySelector('#recordList .row .c-del').click()")
        C.wait_for_function("document.querySelectorAll('#recordList .row').length === 2", timeout=8000)
        check('실제 Firebase: 삭제 반영', len(rows(C)) == 2, len(rows(C)))

        ov = overflow(D)
        check('실제 연결 390px 넘침 없음', not ov, ov)
        D.set_viewport_size({'width': 320, 'height': 700})
        D.wait_for_timeout(250)
        ov = overflow(D)
        check('실제 연결 320px 넘침 없음', not ov, ov)
        trunc = D.evaluate("""() => { const el = document.getElementById('shareLabel'); return el.scrollWidth - el.clientWidth; }""")
        check('320px 상태 라벨 잘리지 않음', trunc <= 1, trunc)
        D.screenshot(path=f'{SHOT}/real-03-320.png')

        check('실제 Firebase 콘솔 오류 0', not (errsC + errsD), errsC + errsD)
        ctxC.close()
        ctxD.close()

        # 테스트 데이터 정리 (연결된 폰이 없을 때 지워야 다시 올라가지 않음)
        import urllib.request
        time.sleep(1.0)
        req = urllib.request.Request(f'{RURL}/rooms/{rpath}.json', method='DELETE')
        urllib.request.urlopen(req).read()
        left = urllib.request.urlopen(f'{RURL}/rooms/{rpath}.json').read().decode()
        time.sleep(2.0)
        left2 = urllib.request.urlopen(f'{RURL}/rooms/{rpath}.json').read().decode()
        check('실제 Firebase: 테스트 방 정리', left == 'null' and left2 == 'null', left + ' / ' + left2)
        browser.close()

    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} 통과')
    if bad:
        for name, _, detail in bad:
            print('  실패:', name, detail)
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
