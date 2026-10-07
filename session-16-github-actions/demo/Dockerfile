FROM python:3.12-alpine
WORKDIR /app
COPY app ./app
CMD ["python", "-c", "from app.calculator import divide; print('Shubham calculator — 9 / 2 =', divide(9, 2))"]
