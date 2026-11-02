"""Entry point for Gunicorn (`gunicorn wsgi:app`) and the `flask --app wsgi …` commands."""
from app import create_app

app = create_app()
