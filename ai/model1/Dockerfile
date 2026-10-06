# Hugging Face Space (Docker) for the Model 1 API. The Space listens on port 7860.
FROM python:3.12-slim
WORKDIR /code
COPY api_requirements.txt .
RUN pip install --no-cache-dir -r api_requirements.txt
COPY app ./app
COPY models ./models
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
