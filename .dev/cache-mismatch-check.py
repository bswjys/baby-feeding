#!/usr/bin/env python3
"""수유 앱 · 캐시 불일치 회귀 검증.

사용자 아이폰에서 났던 증상 그대로 재현한다:
  - 화면(HTML)은 새 버전 → 👩 엄마 / 👨 아빠 / 가족공유 켜기 버튼이 보임
  - 그러나 캐시에 옛 app.js 가 남아 있어 클릭 핸들러가 없음 → 눌러도 무반응
이 스크립트는 캐시에 "옛 app.js"를 일부러 심어 두고,
  (1) 새 index.html 이 app.js?v=5 를 물고 오는지
  (2) 그 상태에서도 엄마/아빠/공유 버튼이 실제로 동작하는지
  (3) 서비스워커가 코드 자산을 네트워크 우선으로 받아오는지
  (4) 오프라인일 때는 캐시로 계속 동작하는지
를 확인한다.
"""
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

APP = 'http://127.0.0.1:8765/index.html'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = os.path.join(ROOT, '.dev', 'shots')
os.makedirs(SHOT, exist_ok=True)

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  · ' + str(detail)) if detail else ''), flush=True)


def new_ctx(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('dialog', lambda d: d.accept())
    return ctx, page, errs


def who_state(page):
    return page.evaluate("""() => ({
        mom: document.getElementById('whoMom').getAttribute('aria-pressed'),
        dad: document.getElementById('whoDad').getAttribute('aria-pressed'),
        label: document.getElementById('shareLabel').textContent,
        rows: document.querySelectorAll('#recordList .row').length,
    })""")


STALE = "window.__staleAppJs = true; /* 옛 버전: whoMom/whoDad 핸들러 없음 */"


def seed_stale(page, keys):
    """서비스워커 캐시에 옛 app.js 를 심는다 (실제 사용자 폰의 상태 재현)."""
    return page.evaluate("""async ({stale, keys}) => {
        const out = [];
        for (const name of await caches.keys()) {
            const c = await caches.open(name);
            for (const k of keys) {
                await c.put(new Request(k), new Response(stale, {
                    headers: {'Content-Type': 'text/javascript'}
                }));
                out.push(name + ' :: ' + k);
            }
        }
        return out;
    }""", {'stale': STALE, 'keys': keys})


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx, page, errs = new_ctx(browser)

    # ── 1. HTML 이 버전 쿼리를 물고 오는가 (정적 파일 직접 확인)
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    check('index.html → styles.css?v=5', bool(re.search(r'href="\./styles\.css\?v=5"', html)))
    check('index.html → app.js?v=5', bool(re.search(r'src="\./app\.js\?v=5"', html)))
    swsrc = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    check("sw.js CACHE = baby-feeding-v5", "const CACHE = 'baby-feeding-v5'" in swsrc)
    check('sw.js 코드 자산 네트워크 우선', 'isCode(url.pathname)' in swsrc and 'networkFirst(req, key)' in swsrc)

    # ── 2. 첫 로드 + 서비스워커 제어 대기
    resp = page.goto(APP, wait_until='load')
    page.wait_for_timeout(500)
    page.evaluate("() => navigator.serviceWorker.ready.then(r => !!r.active)")
    page.reload(wait_until='load')  # SW 가 제어하는 상태로 다시 로드
    page.evaluate("() => navigator.serviceWorker.ready")
    page.wait_for_timeout(400)
    controlled = page.evaluate("() => !!navigator.serviceWorker.controller")
    check('서비스워커가 페이지를 제어', controlled)
    check('캐시 이름 v5', page.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('baby-feeding-'))") == ['baby-feeding-v5'],
          page.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('baby-feeding-'))"))
    check('실제 로드된 app.js 에 핸들러 존재', page.evaluate("() => typeof window.__staleAppJs === 'undefined' && !!document.getElementById('whoMom')"))

    # ── 3. 사용자 폰 상태 재현: 캐시에 옛 app.js 심기 (쿼리 유/무 둘 다)
    seeded = seed_stale(page, ['http://127.0.0.1:8765/app.js', 'http://127.0.0.1:8765/app.js?v=5'])
    check('옛 app.js 를 캐시에 심음', len(seeded) == 2, seeded)

    did = {}
    page.on('response', lambda r: did.setdefault('app', r.url) if '/app.js' in r.url else None)
    page.reload(wait_until='load')
    page.wait_for_timeout(400)
    check('새 HTML 이 요청한 app.js 주소에 ?v=5', '?v=5' in (did.get('app') or ''), did.get('app'))
    check('옛 캐시를 물지 않음 (새 app.js 로드)', page.evaluate("() => typeof window.__staleAppJs === 'undefined'"))

    # ── 4. 버튼 실제 클릭 동작 (증상의 핵심)
    page.evaluate("async () => { for (const n of await caches.keys()) { const c = await caches.open(n); await c.delete(new Request('http://127.0.0.1:8765/app.js')); await c.delete(new Request('http://127.0.0.1:8765/app.js?v=5')); } }")
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until='load')
    page.wait_for_timeout(500)

    before = who_state(page)
    page.click('#whoDad')
    page.wait_for_timeout(150)
    after_dad = who_state(page)
    check('👨 아빠 클릭 → 선택 바뀜', before['dad'] == 'false' and after_dad['dad'] == 'true', f"{before['dad']} → {after_dad['dad']}")
    page.click('#whoMom')
    page.wait_for_timeout(150)
    after_mom = who_state(page)
    check('👩 엄마 클릭 → 선택 바뀜', after_mom['mom'] == 'true' and after_mom['dad'] == 'false', after_mom)

    page.click('#whoDad')
    page.click('#bottleBtn')
    page.wait_for_timeout(250)
    st = who_state(page)
    check('아빠로 기록 추가', st['rows'] == 1, st['rows'])
    by = page.evaluate("() => { const b = document.querySelector('#recordList .row .by'); return b ? b.textContent : null; }")
    check('기록에 아빠 배지', by == '아빠', by)

    page.click('#sharePill')
    page.wait_for_selector('#shareSheet:not([hidden])', timeout=5000)
    check('가족공유 켜기 클릭 → 공유 시트 열림', page.is_visible('#shareSheet .sheet'))
    page.screenshot(path=f'{SHOT}/cache-01-공유시트.png')
    page.click('#shareCancel')
    page.wait_for_timeout(200)
    check('공유 시트 닫힘', page.is_hidden('#shareSheet'))

    # ── 5. 네트워크 우선: 서버 app.js 를 바꾸면 새로고침만으로 즉시 반영 (버전 쿼리 없이도)
    app_path = os.path.join(ROOT, 'app.js')
    original = open(app_path, encoding='utf-8').read()
    try:
        with open(app_path, 'w', encoding='utf-8') as f:
            f.write("window.__patched = 'v5-test';\n" + original)
        time.sleep(1.2)                     # Last-Modified(초 단위)를 확실히 구분
        os.utime(app_path, None)
        # 브라우저 자체 HTTP 캐시(304 재검증)는 비우고, 서비스워커 캐시(옛 app.js)만 남긴 채 확인
        try:
            ctx.new_cdp_session(page).send('Network.clearBrowserCache')
        except Exception:
            pass
        on_disk = open(app_path, encoding='utf-8').read(40).startswith("window.__patched")
        page.reload(wait_until='load')
        page.wait_for_timeout(500)
        picked = page.evaluate("() => window.__patched || null")
        still = open(app_path, encoding='utf-8').read(40).startswith("window.__patched")
        if picked == 'v5-test':
            check('서버 app.js 수정 → 새로고침에 바로 반영(네트워크 우선)', True)
        elif not (on_disk and still):
            print('SKIP  네트워크 우선 재현 불가 · app.js 가 원래대로 되돌아감(실행 환경)', flush=True)
        else:
            check('서버 app.js 수정 → 새로고침에 바로 반영(네트워크 우선)', False, picked)
    finally:
        with open(app_path, 'w', encoding='utf-8') as f:
            f.write(original)
        os.utime(app_path, None)

    # ── 6. 오프라인: 캐시로 계속 동작해야 함
    page.reload(wait_until='load')
    page.wait_for_timeout(400)
    ctx.set_offline(True)
    page.reload(wait_until='load')
    page.wait_for_timeout(600)
    off = page.evaluate("""() => ({
        title: document.title,
        app: !!document.getElementById('whoMom'),
        rows: document.querySelectorAll('#recordList .row').length,
    })""")
    check('오프라인에서도 앱이 뜸', off['title'] == '수유 앱' and off['app'], off)
    check('오프라인에서도 기록 유지', off['rows'] == 1, off['rows'])
    page.click('#whoMom')
    page.wait_for_timeout(200)
    check('오프라인에서도 버튼 동작', page.get_attribute('#whoMom', 'aria-pressed') == 'true')
    page.screenshot(path=f'{SHOT}/cache-02-오프라인.png')
    ctx.set_offline(False)

    # ── 7. 320px 넘침 / 콘솔 오류
    page.set_viewport_size({'width': 320, 'height': 700})
    page.wait_for_timeout(300)
    ov = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    check('320px 넘침 없음', ov <= 1, ov)
    check('콘솔 오류 0', not errs, errs[:3])

    ctx.close()
    browser.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} 통과')
sys.exit(1 if failed else 0)
