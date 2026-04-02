#!/bin/sh

curl -X POST http://localhost:9797/log \
  -H "Content-Type: application/json" \
  -d '{
    "streamName": "chat-1",
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      },
      {
        "role": "assistant",
        "content": "The capital of France is Paris."
      }
    ]
  }'