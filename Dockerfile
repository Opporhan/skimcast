# skimcast sunucusu (server/main.py) için imaj - repo kökünden derlenir çünkü transcript.py'yi
# (skills/summarize/) paylaşıyor. Yalnızca `gcloud run deploy --source .` ile kullanılır; Claude Code
# plugin'i bu imajı hiç kullanmaz (o, kullanıcının kendi Python'unda çalışır).
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY skills/summarize/transcript.py skills/summarize/transcript.py
COPY server/main.py server/main.py
WORKDIR /app/server
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "60", "main:app"]
