#!/usr/bin/env python3
"""HTTPS static server for phone camera (getUserMedia requires secure context)."""
import http.server
import os
import ssl
import subprocess
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8443
CERT = os.path.join(DIR, 'cert.pem')
KEY = os.path.join(DIR, 'key.pem')


def ensure_cert():
    if os.path.isfile(CERT) and os.path.isfile(KEY):
        return
    print('Generating self-signed certificate (cert.pem / key.pem)…')
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY, '-out', CERT,
        '-days', '365', '-nodes',
        '-subj', '/CN=BeybladeArena/O=Local/C=HK',
    ], check=True, cwd=DIR)


def main():
    os.chdir(DIR)
    ensure_cert()
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f'HTTPS: https://0.0.0.0:{PORT}/')
    print('Phone camera links use this port. Accept the certificate warning on phone first.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
