#!/bin/bash
# API速度测试脚本
# 用法: bash test_api_speed.sh

TOKEN="18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9"
API_URL="https://affiliates.mobipium.com/api/cpa/findmyoffers"

echo "=========================================="
echo "Mobipium API 速度测试"
echo "=========================================="
echo "开始时间: $(date)"
echo ""

# 测试1: 单请求延迟
echo "【测试1】单请求延迟 (5次)"
for i in 1 2 3 4 5; do
  START=$(date +%s.%N)
  curl -s "$API_URL?mwsd=$TOKEN&limit=1&pages=1" -o /dev/null
  END=$(date +%s.%N)
  echo "第${i}次: $(echo "$END - $START" | bc)秒"
done
echo ""

# 测试2: 串行10请求
echo "【测试2】串行10请求"
START=$(date +%s.%N)
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s "$API_URL?mwsd=$TOKEN&limit=100&pages=$i" -o /dev/null
done
END=$(date +%s.%N)
echo "10页串行总耗时: $(echo "$END - $START" | bc)秒"
echo ""

# 测试3: 并发5请求
echo "【测试3】并发5请求"
START=$(date +%s.%N)
for i in 1 2 3 4 5; do
  curl -s "$API_URL?mwsd=$TOKEN&limit=100&pages=$i" -o /dev/null &
done
wait
END=$(date +%s.%N)
echo "5页并发总耗时: $(echo "$END - $START" | bc)秒"
echo ""

# 测试4: 并发10请求
echo "【测试4】并发10请求"
START=$(date +%s.%N)
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s "$API_URL?mwsd=$TOKEN&limit=100&pages=$i" -o /dev/null &
done
wait
END=$(date +%s.%N)
echo "10页并发总耗时: $(echo "$END - $START" | bc)秒"
echo ""

# 测试5: 并发20请求
echo "【测试5】并发20请求"
START=$(date +%s.%N)
for i in $(seq 1 20); do
  curl -s "$API_URL?mwsd=$TOKEN&limit=100&pages=$i" -o /dev/null &
done
wait
END=$(date +%s.%N)
echo "20页并发总耗时: $(echo "$END - $START" | bc)秒"
echo ""

echo "=========================================="
echo "结束时间: $(date)"
echo "=========================================="
