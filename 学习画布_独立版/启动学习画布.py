# -*- coding: utf-8 -*-
"""
学习路径画布 · 启动器
双击 启动学习画布.bat 启动，浏览器自动打开
"""
import os, sys, time, threading, webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

_HERE = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(_HERE, "dist")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # 静默，不打日志


def main():
    port = 5173
    url = f"http://127.0.0.1:{port}/"

    print("=" * 50)
    print("  学习路径画布")
    print(f"  地址: {url}")
    print("  浏览器会自动打开，按 Ctrl+C 关闭")
    print("=" * 50)

    def open_browser():
        time.sleep(0.8)
        try:
            webbrowser.open(url)
        except:
            pass

    threading.Thread(target=open_browser, daemon=True).start()

    server = HTTPServer(("127.0.0.1", port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已关闭")


if __name__ == "__main__":
    main()
