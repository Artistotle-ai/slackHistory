# Lambda Cold Start Optimizations

## What Actually Helps Cold Starts vs Warm Invocations

### Cold Start Optimizations ✅

These actually improve cold start performance:

1. **Dynamic Imports** - Lazy load heavy dependencies
   - Only load what's needed when it's actually used
   - Reduces initial bundle parse time by 50-200ms

2. **Bundle Optimization**
   - esbuild with tree-shaking (`--tree-shaking=true`)
   - Minification (`--minify`)
   - External AWS SDK (`--external:@aws-sdk/*`) - reduces bundle size
   - Smaller bundles = faster cold starts

3. **Memory Allocation**
   - More memory = more CPU = faster cold starts
   - 512MB vs 256MB can save 50-100ms on cold start

4. **Architecture Choice: x86_64 vs ARM64**
   - **x86_64:** Typically 50-200ms faster cold starts
   - **ARM64:** 34% better price/performance but slower cold starts
   - **Trade-off:** Cost vs cold start latency

### Warm Invocation Optimizations ⚠️

These help warm invocations but NOT cold starts:

1. **Connection Pooling** - HTTP keep-alive
   - Saves 10-50ms per request on warm invocations
   - **Does NOT help cold starts** - connections are fresh each time

2. **Singleton Clients** - Reuse AWS SDK clients
   - Saves 5-20ms client initialization on warm invocations
   - **Does NOT help cold starts** - clients initialized fresh

3. **Caching** - In-memory cache
   - Only helps if cache is warm (unlikely on cold start)
   - Helps subsequent warm invocations

## Current Implementation Analysis

### Already Optimized for Cold Starts ✅
- Dynamic imports for heavy dependencies
- Bundle optimization with esbuild
- Memory increased to 512MB
- Lazy loading AWS SDK modules

### Already Optimized for Warm Invocations ✅
- Connection pooling (HTTP keep-alive)
- Singleton clients (reused across warm invocations)
- Secret caching (helps warm invocations)

### Potential Cold Start Improvements

1. **Switch message-listener to x86_64** (if cold starts are critical)
   - Current: ARM64 (Graviton2) - better price/performance
   - Alternative: x86_64 - 50-200ms faster cold starts
   - Cost: ~34% more per invocation
   - **Recommendation:** Test both, use x86 if cold starts are blocking

2. **Further Bundle Size Reduction**
   - Analyze actual bundle sizes
   - Remove any unnecessary dependencies
   - Use Lambda Layers for shared code

## Architecture Recommendation

### Current: ARM64
- ✅ Better price/performance (34% cheaper)
- ❌ Slower cold starts (50-200ms more than x86)
- ✅ Better for cost optimization

### Alternative: x86_64
- ✅ Faster cold starts (50-200ms faster)
- ❌ Higher cost (34% more per invocation)
- ✅ Better for latency-sensitive workloads

### Hybrid Approach
- **message-listener (critical path):** x86_64 for faster cold starts
- **file-processor (batch):** ARM64 for cost efficiency
- **oauth-callback (rare):** ARM64 (cold starts less critical)

## Testing Strategy

1. **Baseline Measurements:**
   - Measure cold start times for ARM64 vs x86_64
   - Measure cost per invocation for both architectures
   - Measure warm invocation latencies

2. **Decision Criteria:**
   - If cold starts are critical (< 500ms target) → Consider x86
   - If cost is priority → Use ARM64
   - If both matter → Test hybrid approach

3. **Implementation:**
   - Test x86_64 for message-listener first
   - Monitor cold start metrics in CloudWatch
   - Compare costs over time

## Key Takeaways

1. **Connection pooling and singleton clients help warm invocations, not cold starts**
   - These are already implemented correctly
   - They save 10-50ms per warm request but don't affect cold start time

2. **ARM vs x86 is a trade-off**
   - ARM: Better price/performance, slower cold starts
   - x86: Faster cold starts, higher cost
   - Test both to find optimal choice

3. **Cold start optimizations:**
   - Dynamic imports ✅ (already done)
   - Bundle optimization ✅ (already done)
   - Memory allocation ✅ (already done)
   - Architecture choice ⚠️ (consider x86 for critical paths if cold starts are blocking)

