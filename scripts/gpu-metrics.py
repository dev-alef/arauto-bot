"""Expõe métricas NVIDIA somente na rede interna do Compose."""

import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_error(404)
            return
        try:
            resultado = subprocess.run(
                ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total',
                 '--format=csv,noheader,nounits'],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1,
            )
            corpo = resultado.stdout
            if not corpo or len(corpo) > 4096:
                raise ValueError('Saída NVIDIA inválida')
            status = 200
        except (OSError, ValueError, subprocess.SubprocessError):
            status, corpo = 503, b''
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(corpo)))
        self.end_headers()
        try:
            self.wfile.write(corpo)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, formato, *args):
        pass


if __name__ == '__main__':
    porta = int(os.environ.get('AR_AUTO_GPU_METRICS_PORT', '9988'))
    servidor = HTTPServer(('0.0.0.0', porta), Handler)
    print(f'Monitor de GPU iniciado na porta {servidor.server_port}.', flush=True)
    servidor.serve_forever()
