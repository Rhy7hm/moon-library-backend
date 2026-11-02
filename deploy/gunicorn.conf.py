"""
Gunicorn settings for production:   gunicorn -c deploy/gunicorn.conf.py wsgi:app
(run from the project folder, with the virtualenv active and .env filled in)
"""
import multiprocessing
import os

# only the reverse proxy (nginx / CloudPanel) talks to Gunicorn
bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8100")

# Threads, not just processes: file downloads (/f/…) and ZIPs are streamed for as long as the
# visitor's connection needs, and a thread waiting on the network doesn't block the others.
worker_class = "gthread"
workers = int(os.environ.get("GUNICORN_WORKERS", min(4, multiprocessing.cpu_count() * 2)))
threads = int(os.environ.get("GUNICORN_THREADS", 8))

# Seconds a worker may stay silent before it's restarted. Uploads send ≤ 20 MB per request and
# "Back up now" stops itself after ~20 s, so 120 s is plenty. The 5-minute Drive backup does NOT
# run in Gunicorn — cron runs `flask backup run` on its own (deploy/crontab.example).
timeout = 120
graceful_timeout = 30
keepalive = 5

# recycle workers now and then (guards against slow memory growth)
max_requests = 2000
max_requests_jitter = 200

# The proxy in front sets X-Forwarded-For / -Proto / -Host; Flask trusts them through
# TRUST_PROXY_HOPS (.env). Gunicorn itself only needs to accept them from the proxy.
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")

accesslog = "-"
errorlog = "-"
loglevel = "info"
