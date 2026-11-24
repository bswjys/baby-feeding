#!/usr/bin/env python3
"""수유 앱 · 라이브(bswjys.github.io) 서비스워커/캐시 확인.

배포된 라이브 주소에서
  - index.html 이 app.js?v=5 / styles.css?v=5 를 물고 오는지
  - 서비스워커가 v5 로 설치되고 옛 캐시(baby-feeding-v1~v3)가 지워지는지
  - 캐시에 옛 app.js 가 남아 있어도 새로고침 한 번에 새 app.js 로 바뀌는지
  - 엄마/아빠/공유 버튼이 실제로 눌리는지
를 확인한다. (기록은 localStorage 에만 남고 방은 만들지 않는다)
"""
import os
import sys

from playwright.sync_api import sync_playwright

APP = 'https://bswjys.github.io/baby-feeding/'
SHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
os.makedirs(SHOT, exist_ok=True)
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  · ' + str(detail)) if detail else ''), flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('dialog', lambda d: d.accept())

    page.goto(APP, wait_until='load', timeout=45000)
    page.wait_for_timeout(1200)
    scripts = page.evaluate("() => Array.from(document.scripts).map(s => s.src)")
    links = page.evaluate("() => Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(l => l.href)")
    check('라이브 HTML 이 app.js?v=5', any('app.js?v=5' in s for s in scripts), scripts)
    check('라이브 HTML 이 styles.css?v=5', any('styles.css?v=5' in l for l in links), links)

    page.wait_for_timeout(2500)          # 서비스워커 설치 대기
    page.reload(wait_until='load', timeout=45000)
    page.wait_for_timeout(1200)
    ctrl = page.evaluate("() => !!navigator.serviceWorker.controller")
    keys = page.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('baby-feeding-'))")
    check('서비스워커가 페이지 제어', ctrl)
    check('캐시는 baby-feeding-v5 만', keys == ['baby-feeding-v5'], keys)
    cache_urls = page.evaluate("""async () => {
        const out = [];
        for (const n of await caches.keys()) {
            const c = await caches.open(n);
            for (const r of await c.keys()) out.push(r.url);
        }
        return out;
    }""")
    check('v5 캐시에 app.js?v=5 포함', any('app.js?v=5' in u for u in cache_urls), len(cache_urls))

    # 옛 app.js 를 캐시에 심어 두고 새로고침 → 네트워크 우선이면 새 파일로 교체된다
    page.evaluate("""async () => {
        const c = await caches.open('baby-feeding-v5');
        await c.put(new Request(location.origin + '/baby-feeding/app.js'), new Response('window.__stale = 1;'));
    }""")
    page.reload(wait_until='load', timeout=45000)
    page.wait_for_timeout(1200)
    check('옛 캐시가 있어도 새 app.js 로드', page.evaluate("() => !window.__stale"))

    # 버튼 실제 동작
    page.click('#whoDad')
    page.wait_for_timeout(200)
    check('👨 아빠 버튼 동작', page.get_attribute('#whoDad', 'aria-pressed') == 'true')
    page.click('#whoMom')
    page.wait_for_timeout(200)
    check('👩 엄마 버튼 동작', page.get_attribute('#whoMom', 'aria-pressed') == 'true')
    page.click('#whoDad')
    page.click('#bottleBtn')
    page.wait_for_timeout(300)
    check('아빠로 기록 1건', page.evaluate("() => document.querySelectorAll('#recordList .row').length") == 1)
    page.click('#sharePill')
    page.wait_for_selector('#shareSheet:not([hidden])', timeout=8000)
    check('가족공유 켜기 버튼 → 공유 시트', page.is_visible('#shareSheet .sheet'))
    page.screenshot(path=os.path.join(SHOT, 'live-cache-공유시트.png'))
    page.click('#shareCancel')

    # 홈 화면 앱처럼 루트 주소로 열 때, 오프라인에서도 떠야 한다
    page.reload(wait_until='load', timeout=45000)
    page.wait_for_timeout(900)
    ctx.set_offline(True)
    page.goto(APP, wait_until='load', timeout=45000)
    page.wait_for_timeout(600)
    off = page.evaluate("() => ({title: document.title, btn: !!document.getElementById('whoMom')})")
    check('오프라인에서 루트 주소로도 앱이 뜸', off['title'] == '수유 앱' and off['btn'], off)
    ctx.set_offline(False)
    page.reload(wait_until='load', timeout=45000)
    page.wait_for_timeout(600)

    page.set_viewport_size({'width': 320, 'height': 700})
    page.wait_for_timeout(400)
    ov = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    check('320px 넘침 없음', ov <= 1, ov)
    check('콘솔 오류 0', not errs, errs[:3])

    ctx.close()
    browser.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} 통과')
sys.exit(1 if failed else 0)
