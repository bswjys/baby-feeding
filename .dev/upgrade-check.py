#!/usr/bin/env python3
"""수유 앱 · 실제 업그레이드 경로 검증.

사용자 아이폰 상태를 그대로 만든다:
  1) 옛 서비스워커(v3, 캐시 우선) + 옛 app.js(엄마/아빠 버튼 핸들러 없음)가 설치된 기기
  2) 새 버전을 배포
  3) 앱을 다시 열었을 때 버튼이 살아나고, 서비스워커·캐시가 v4 로 넘어오는지 확인
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEVDIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8767
APP = f'http://127.0.0.1:{PORT}/index.html'

OLD_APP_JS = """/* 옛 버전(v1/v2) app.js — whoMom/whoDad/sharePill 핸들러 없음 (SW 등록은 했음) */
window.__oldAppJs = true;
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('timeVal');
  if (el) el.textContent = '2:00';
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
"""

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  · ' + str(detail)) if detail else ''), flush=True)


def wait_port(port, timeout=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.15)
    return False


def main():
    tmp = tempfile.mkdtemp(prefix='bf-upgrade-')
    for name in os.listdir(ROOT):
        if name in ('.git', '.dev'):
            continue
        src = os.path.join(ROOT, name)
        dst = os.path.join(tmp, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # 옛 서비스워커(v3) = 배포본 그대로, 옛 app.js = 핸들러 없는 버전
    old_sw = subprocess.check_output(['git', 'show', 'HEAD:sw.js'], cwd=ROOT).decode('utf-8')
    check('옛 sw.js 는 v3 (재현 조건)', "const CACHE = 'baby-feeding-v3'" in old_sw)
    with open(os.path.join(tmp, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(old_sw)
    with open(os.path.join(tmp, 'app.js'), 'w', encoding='utf-8') as f:
        f.write(OLD_APP_JS)
    # 옛 HTML: 버전 쿼리 없는 상태
    idx = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    with open(os.path.join(tmp, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(idx.replace('./styles.css?v=4', './styles.css').replace('./app.js?v=4', './app.js'))

    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                           cwd=tmp, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(PORT):
        print('FAIL  로컬 서버 기동')
        srv.kill()
        return 1

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('dialog', lambda d: d.accept())

            # ── ① 옛 버전 사용 중인 기기
            page.goto(APP, wait_until='load')
            page.wait_for_timeout(1500)   # 옛 app.js 가 sw.js 등록 → 설치
            page.reload(wait_until='load')
            page.wait_for_timeout(700)
            old = page.evaluate("""() => ({
                ctrl: !!navigator.serviceWorker.controller,
                oldApp: !!window.__oldAppJs,
                caches: null,
            })""")
            check('옛 서비스워커가 제어 중', old['ctrl'])
            check('옛 app.js 로드됨(재현 성공)', old['oldApp'], old)
            page.click('#whoDad')
            page.wait_for_timeout(200)
            broken = page.get_attribute('#whoDad', 'aria-pressed')
            check('옛 버전에서는 아빠 버튼 무반응(증상 재현)', broken == 'false', broken)
            check('옛 캐시는 v3', page.evaluate("async () => (await caches.keys()).filter(k=>k.startsWith('baby-feeding-'))") == ['baby-feeding-v3'],
                  page.evaluate("async () => (await caches.keys()).filter(k=>k.startsWith('baby-feeding-'))"))
            page.screenshot(path=os.path.join(DEVDIR, 'shots', 'upgrade-01-옛버전.png'))

            # ── ② 새 버전 배포 (실제 배포 파일로 교체 · 배포처럼 mtime 도 갱신)
            for name in ('index.html', 'app.js', 'styles.css', 'sw.js'):
                shutil.copyfile(os.path.join(ROOT, name), os.path.join(tmp, name))
            time.sleep(1.2)                      # Last-Modified 초 단위 구분
            for name in ('index.html', 'app.js', 'styles.css', 'sw.js'):
                os.utime(os.path.join(tmp, name), None)
            check('배포할 index.html 에 ?v=4', 'app.js?v=4' in open(os.path.join(tmp, 'index.html'), encoding='utf-8').read())

            # ── ③ 사용자가 앱을 다시 연다
            page.reload(wait_until='load')
            page.wait_for_timeout(800)
            now = page.evaluate("() => ({oldApp: !!window.__oldAppJs, hasBtn: !!document.getElementById('whoMom')})")
            check('새 app.js 로 교체됨(버튼 무반응 해소)', not now['oldApp'] and now['hasBtn'], now)

            page.click('#whoDad')
            page.wait_for_timeout(250)
            check('👨 아빠 버튼 동작', page.get_attribute('#whoDad', 'aria-pressed') == 'true')
            page.click('#whoMom')
            page.wait_for_timeout(200)
            check('👩 엄마 버튼 동작', page.get_attribute('#whoMom', 'aria-pressed') == 'true')
            page.click('#sharePill')
            page.wait_for_selector('#shareSheet:not([hidden])', timeout=5000)
            check('로컬 저장 모드 버튼 동작', page.is_visible('#shareSheet .sheet'))
            page.click('#shareCancel')
            page.screenshot(path=os.path.join(DEVDIR, 'shots', 'upgrade-02-수정후.png'))

            # ── ④ 두 번째 방문(새 서비스워커 적용 확인)
            page.reload(wait_until='load')
            page.wait_for_timeout(1200)
            keys = page.evaluate("async () => (await caches.keys()).filter(k=>k.startsWith('baby-feeding-'))")
            check('캐시가 v4 만 남음', keys == ['baby-feeding-v4'], keys)
            scripts = page.evaluate("() => Array.from(document.scripts).map(s => s.src)")
            check('새 HTML 이 app.js?v=4 로드', any('app.js?v=4' in s for s in scripts), scripts)
            cache_keys = page.evaluate("""async () => {
                const c = await caches.open('baby-feeding-v4');
                return (await c.keys()).map(r => r.url);
            }""")
            check('v4 캐시에 app.js?v=4 포함', any('app.js?v=4' in u for u in cache_keys))
            page.click('#whoDad')
            page.wait_for_timeout(200)
            check('업그레이드 후에도 버튼 동작', page.get_attribute('#whoDad', 'aria-pressed') == 'true')
            check('콘솔 예외 0', not errs, errs[:3])

            ctx.close()
            browser.close()
    finally:
        srv.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} 통과')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
