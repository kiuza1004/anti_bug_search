"""
BugFinder AI - Local Server
모바일 및 PC 브라우저에서 즉시 실행 가능한 초경량 로컬 웹 서버
추가 패키지 설치 없이 Python 표준 라이브러리만으로 동작합니다.
"""

import http.server
import socket
import socketserver
import os
import sys

PORT = 8000

def get_local_ip():
    """로컬 네트워크의 IPv4 주소를 자동으로 감지합니다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 외부 연결 없이 라우팅 테이블을 통해 로컬 IP를 파악
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    """캐시 방지 및 올바른 MIME 타입을 보장하는 핸들러"""
    def end_headers(self):
        # 개발 중 변경사항 즉시 반영을 위한 캐시 무효화 헤더
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    # 스크립트가 위치한 디렉터리로 작업 경로 고정
    app_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(app_dir)

    local_ip = get_local_ip()

    print("=" * 66)
    print(" 🦟 BugFinder AI - 모기·벌레 탐지 서버가 시작되었습니다!")
    print("=" * 66)
    print()
    print(" [1] PC 브라우저에서 테스트할 때:")
    print(f"     👉 http://localhost:{PORT}")
    print()
    print(" [2] 핸드폰(스마트폰) 카메라로 실행할 때:")
    print(f"     👉 http://{local_ip}:{PORT}")
    print()
    print(" 💡 스마트폰 접속 시 카메라 권한 팁:")
    print("    • 스마트폰과 PC가 같은 Wi-Fi(공유기)에 연결되어 있어야 합니다.")
    print("    • 모바일 크롬에서 카메라 권한이 필요할 경우:")
    print("      1) 스마트폰 크롬 주소창에 chrome://flags 입력")
    print("      2) 'unsafely-treat-insecure-origin-as-secure' 검색")
    print(f"      3) Enabled 설정 후 http://{local_ip}:{PORT} 입력하고 재실행(Relaunch)")
    print("=" * 66)
    print(" 서버를 종료하려면 터미널에서 Ctrl + C 를 누르세요.")
    print("=" * 66)
    print()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 안전하게 종료했습니다.")

if __name__ == '__main__':
    main()
