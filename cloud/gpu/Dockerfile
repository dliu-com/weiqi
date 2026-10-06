FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir boto3==1.40.0
RUN curl -fSL https://github.com/lightvector/KataGo/releases/download/v1.18.2/katago-v1.18.2-cuda12.1-cudnn8.9.7-linux-x64.zip -o /tmp/katago.zip && echo '16c69f42291fe8c6d196d722d92299a5b04de852611d6c022a0dd9e0e83b5688  /tmp/katago.zip' | sha256sum -c - && mkdir /engine && unzip /tmp/katago.zip -d /engine && chmod +x /engine/katago && rm /tmp/katago.zip
COPY worker/worker.py /app/worker.py
ENV KATAGO_BIN=/engine/katago BACKEND=gpu SEARCH_THREADS=1 ANALYSIS_THREADS=16 NN_THREADS=1 NN_MAX_BATCH_SIZE=32
ENTRYPOINT ["python3","/app/worker.py"]
