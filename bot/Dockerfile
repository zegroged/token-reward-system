FROM python:3.12-slim

# Non-root user oluştur
RUN groupadd -g 1001 botgroup && \
    useradd -u 1001 -g botgroup -m -s /bin/sh botuser

WORKDIR /app

# Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Source code
COPY . .

# Ownership
RUN chown -R botuser:botgroup /app

USER botuser

CMD ["python", "main.py"]
