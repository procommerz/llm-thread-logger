#!/bin/sh

STREAM_NAMES="chat-1 chat-1-sub1 chat-1-sub2"

USER_MESSAGES="What is the capital of France?
Can you explain how transformers work in machine learning?
Write me a haiku about autumn.
What are the main differences between Python and JavaScript?
How does photosynthesis work?
Summarize the plot of Hamlet in two sentences.
What is the time complexity of quicksort?
Explain the concept of entropy in simple terms.
What are some good practices for REST API design?
Can you help me debug this code?"

ASSISTANT_MESSAGES="The capital of France is Paris, one of the most visited cities in the world.
Transformers use self-attention mechanisms to weigh the relevance of different parts of the input sequence when producing each output token.
Crimson leaves descend / Silence wraps the cooling earth / One last cricket sings
Python emphasizes readability and is widely used in data science, while JavaScript is the language of the web and runs natively in browsers.
Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen using chlorophyll.
Hamlet, a Danish prince, seeks revenge for his father's murder by his uncle Claudius, who has taken the throne and married Hamlet's mother — ending in a tragic chain of deaths.
Quicksort has an average time complexity of O(n log n), but degrades to O(n²) in the worst case with poor pivot selection.
Entropy is a measure of disorder or unpredictability in a system — the more random and spread out the energy or information, the higher the entropy.
Good REST API practices include using meaningful resource names, consistent HTTP verbs, versioning, proper status codes, and clear error responses.
Sure! Please share the code and describe what behavior you're seeing versus what you expect."

pick_random() {
  list="$1"
  count=$(echo "$list" | wc -l | tr -d ' ')
  index=$(( (RANDOM % count) + 1 ))
  echo "$list" | sed -n "${index}p"
}

NUM_REQUESTS=${1:-256}
DELAY=${2:-0.5}

i=0
while [ $i -lt $NUM_REQUESTS ]; do
  stream=$(pick_random "$(echo "$STREAM_NAMES" | tr ' ' '\n')")
  user_msg=$(pick_random "$USER_MESSAGES")
  asst_msg=$(pick_random "$ASSISTANT_MESSAGES")

  payload=$(printf '{"streamName":"%s","messages":[{"role":"user","content":"%s"},{"role":"assistant","content":"%s"}]}' \
    "$stream" \
    "$(echo "$user_msg" | sed "s/'/\\\\'/g")" \
    "$(echo "$asst_msg" | sed "s/'/\\\\'/g")")

  curl -s -X POST http://localhost:9797/log \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null

  echo "[$stream] user: $user_msg"

  sleep "$DELAY"
  i=$(( i + 1 ))
done
