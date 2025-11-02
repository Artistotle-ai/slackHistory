# Lambda Performance Optimizations

## Already Implemented ✅

### Cold Start Optimizations
1. **Dynamic Imports** - Lazy load heavy dependencies (AWS SDK, event handlers, modules)
   - Only load what's needed when it's actually used
   - Reduces initial bundle parse time significantly

2. **Bundle Optimization**
   - esbuild with tree-shaking enabled (`--tree-shaking=true`)
   - Minification (`--minify`)
   - External AWS SDK (`--external:@aws-sdk/*`) - provided by Lambda runtime
   - Target Node.js 22 (`--target=node22`)

3. **Memory Allocation**
   - Increased to 512MB for message-listener and oauth-callback
   - More memory = more CPU = faster cold starts and execution

4. **Connection Pooling** ⚠️ Warm Invocations Only
   - HTTP/HTTPS agents with keep-alive enabled
   - **Only helps warm invocations** - saves ~10-50ms per request by reusing connections
   - **Does NOT help cold starts** - connections are established fresh on each cold start
   - Configured in DynamoDB and Secrets Manager clients

5. **Singleton Clients** ⚠️ Warm Invocations Only
   - AWS SDK clients created once and reused across warm invocations
   - **Only helps warm invocations** - saves client initialization time (~5-20ms)
   - **Does NOT help cold starts** - clients are initialized fresh on each cold start
   - Global variables persist in Lambda execution environment

6. **Caching**
   - Secrets cached for 1 hour (configurable via `SECRET_CACHE_TTL`)
   - Reduces Secrets Manager API calls
   - **Helps both cold and warm starts** if cache is warm (unlikely on cold start)

7. **Architecture** ⚠️ Trade-off
   - **ARM64 (Graviton2)** - 34% better price/performance than x86_64
   - **BUT:** ARM often has **slightly worse cold starts** (especially for interpreted languages like Node.js)
   - **x86_64** - typically 50-200ms faster cold starts, but higher cost per invocation
   - **Recommendation:** Test both - if cold starts are critical, consider x86 for critical paths

## Additional Optimizations Available 🚀

### High Impact

#### 1. **Lambda Layers** (Reduce Package Size)
**For:** Shared dependencies (`slack-shared`, potentially AWS SDK if not using runtime SDK)

**Benefits:**
- Smaller deployment packages = faster cold starts
- Shared code cached across functions
- Faster deployments

**Implementation:**
- Create layer with `slack-shared` dependencies
- Upload once, reference in all Lambda functions
- Can reduce package size by ~20-30%

**Trade-offs:**
- Extra deployment step
- Layer size limit: 50MB (unzipped)
- 250MB total (code + layers)

#### 3. **Memory Tuning** (Cost/Performance Optimization)
**Current:** 512MB for all functions

**Recommendation:**
- Use AWS Lambda Power Tuning tool to find optimal memory
- Test 256MB, 512MB, 768MB, 1024MB
- Balance: More memory = faster but more expensive

**Expected:**
- Sweet spot often around 512-768MB for most workloads
- Can save 10-20% cost if optimal is lower than current

### Medium Impact

#### 4. **Environment Variables Minimization**
**Current:** Each env var adds ~5ms to cold start

**Optimization:**
- Review if all env vars are necessary
- Consider moving some values to parameter store (SSM) and caching them
- Only read from SSM on cold start, cache in memory

**Current env vars:**
- `message-listener`: 2 env vars (SLACK_ARCHIVE_TABLE, SLACK_SIGNING_SECRET_ARN)
- `file-processor`: 4 env vars
- `oauth-callback`: 4 env vars

**Impact:** Low (already minimal, but can cache SSM if needed)

#### 5. **Ephemeral Storage Optimization**
**Current:** Default 512MB (minimum)

**Optimization:** Already optimal - 512MB is minimum, can't reduce further

#### 6. **Reserved Concurrency**
**Current:** None (good for scalability)

**Consideration:** 
- Only add if you need to throttle or ensure minimum capacity
- Currently: No reserved concurrency (unlimited scale) ✅

### Low Impact (Already Optimized)

#### 7. **Bundle Size Analysis**
**Current:** Using esbuild with tree-shaking and minification

**Further Optimization:**
- Analyze actual bundle sizes after deployment
- Check if any unnecessary code is included
- Use `--analyze` flag or bundle size analyzer

**Expected Impact:** Minimal (already well optimized)

#### 8. **Connection Pool Tuning**
**Current:** Keep-alive with 30s timeout, 50 max sockets

**Optimization:**
- Already optimized for Lambda (connections persist across warm invocations)
- **Note:** Only helps warm invocations, not cold starts
- Could tune based on actual usage patterns

**Impact:** Medium for warm invocations (saves 10-50ms per request), Zero for cold starts

## Recommendations by Priority

### Priority 1 (High Impact if Cold Starts Critical)
1. **Switch message-listener to x86_64 Architecture** - Faster cold starts
   - ARM64 has ~50-200ms slower cold starts than x86
   - x86_64 costs ~34% more per invocation but has better cold start performance
   - **Recommendation:** Test both architectures for message-listener (critical path)
   - If cold starts are critical, use x86 for message-listener, ARM for file-processor

### Priority 2 (High Impact, Medium Effort)
2. **Lambda Layers for shared code** - Reduce package sizes
   - Create layer with `slack-shared`
   - Update all functions to use layer

### Priority 4 (Medium Impact, Low Effort)
4. **Memory Tuning** - Find optimal memory allocation
   - Use Lambda Power Tuning tool
   - Test different memory sizes

### Priority 4 (Low Impact, Low Effort)
4. **Environment Variable Optimization** - Minimize cold start impact
   - Only if env vars grow significantly
   - Consider SSM Parameter Store caching

## Metrics to Monitor

1. **Cold Start Duration** - Target: < 500ms for message-listener
2. **Warm Invocation Duration** - Target: < 100ms for simple events
3. **Bundle Size** - Monitor deployment package sizes
4. **Memory Usage** - Use CloudWatch Insights to find peak memory
5. **Cost per Invocation** - Track cost efficiency

## Implementation Notes

### Lambda Layers
- Layer size: Max 50MB (unzipped)
- Layer count: Up to 5 layers per function
- Shared layers across functions reduce total storage

### Memory Tuning
- Use AWS Lambda Power Tuning tool (Step Functions state machine)
- Test with production-like workload
- Consider cost vs performance trade-offs

## References
- [AWS Lambda Performance Optimization](https://aws.amazon.com/blogs/compute/optimizing-aws-lambda-cost-performance-part-1/)
- [Lambda Power Tuning Tool](https://github.com/alexcasalboni/aws-lambda-power-tuning)

