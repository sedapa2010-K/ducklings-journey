"""로컬 테스트 서버 (캐시 끔). 사용법: python serve.py [포트]
같은 Wi-Fi의 폰에서 http://<PC IP>:<포트> 로 접속할 수 있습니다.
(iOS 기울기 센서는 HTTPS에서만 동작하므로 폰 테스트는 README 참고)"""
import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCache).serve_forever()
