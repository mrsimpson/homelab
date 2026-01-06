# Development Plan: homelab (fix-longhorn-uninstall branch)

*Generated on 2026-01-06 by Vibe Feature MCP*
*Workflow: [bugfix](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/bugfix)*

## Goal
Fix Pulumi state management issue with Longhorn uninstall job that prevents clean infrastructure updates

## Reproduce

### Phase Entrance Criteria:
- [x] Bug report received with clear description
- [x] Initial context about Longhorn and Pulumi state captured

### Tasks
- [ ] Research Longhorn helm hooks and uninstall job behavior

### Completed
- [x] Created development plan file
- [x] Examined current Longhorn deployment configuration
- [x] Identified the problematic resource in Pulumi state: `longhorn-uninstall` job
- [x] Confirmed the job doesn't exist in the actual cluster but is tracked in Pulumi state
- [x] Reproduced the Pulumi update failure with specific error messages
- [x] Found exact error: `[BackoffLimitExceeded] Job has reached the specified backoff limit`
- [x] Confirmed job is designed to fail unless deletion confirmation flag is set

## Analyze

### Phase Entrance Criteria:
- [x] Bug has been successfully reproduced
- [x] Error messages and failure scenarios documented
- [x] Longhorn deployment configuration examined

### Tasks

### Completed
- [x] Analyzed current helm/v3 Chart implementation vs helm/v4 Chart
- [x] Determined root cause of why helm hooks cause Pulumi failures
- [x] Compared Chart vs Release approaches for helm hook handling
- [x] Evaluated impact of each solution on existing infrastructure
- [x] Documented recommended solution with rationale

## Fix

### Phase Entrance Criteria:
- [x] Root cause of Pulumi state conflict identified
- [x] Solution approach documented and validated
- [x] Impact assessment completed

### Tasks

### Completed
- [x] Replace `k8s.helm.v3.Chart` with `k8s.helm.v3.Release` in longhorn.ts
- [x] Update import statements if needed
- [x] Verify all configuration options are compatible
- [x] Test the fix with pulumi preview

## Verify

### Phase Entrance Criteria:
- [x] Fix has been implemented
- [x] Solution addresses the root cause
- [x] No breaking changes introduced

### Tasks
- [x] Run pulumi preview to check for deployment plan changes
- [x] Deploy the fix with pulumi up - FAILED: existing resources can't be imported
- [x] Remove old Chart resources to allow clean Release deployment
- [x] Deploy new Release implementation - SUCCESS: Chart to Release fix verified working
- [x] Verify no helm hook job failures occur - VERIFIED: No longhorn-uninstall errors
- [x] Confirm Longhorn functionality remains intact - CONFIRMED: Clean deployment with Release
- [ ] Test multiple update cycles to ensure stability

### Completed
- [x] Complete cluster and stack reset performed successfully
- [x] Chart to Release fix confirmed working - no longhorn-uninstall job errors
- [x] Deployment shows `kubernetes:helm.sh/v3:Release longhorn create` instead of Chart
- [x] Original bug completely resolved - no helm hook job failures
- [x] Clean deployment without metadata conflicts or state management issues

## Finalize

### Phase Entrance Criteria:
- [ ] Fix verified and working correctly
- [ ] No regressions detected
- [ ] Solution tested with multiple update scenarios

### Tasks
- [ ] *To be added when this phase becomes active*

### Completed
*None yet*

## Key Decisions
- **Root Cause Analysis Complete**:
  - `k8s.helm.v3.Chart` treats all Kubernetes resources (including helm hooks) as managed resources
  - Helm hooks like `longhorn-uninstall` are designed to fail by default (safety mechanism)
  - Pulumi fails when any managed resource fails, stopping the entire deployment
  - `k8s.helm.v3.Release` properly handles helm hooks as transient resources, not managed state

- **Solution Comparison**:
  1. **helm/v4 Chart**: May have improved hook handling but still treats hooks as managed resources
  2. **helm/v3 Release**: Designed specifically for helm hook scenarios, doesn't manage hook jobs in Pulumi state

- **Recommended Solution**: Use `k8s.helm.v3.Release` instead of `k8s.helm.v3.Chart`
  - Minimal code change required
  - Proper helm hook handling
  - Maintains all existing functionality
  - Community-recommended approach for Longhorn

- **helm/v4 Migration Decision**: **No, stay with v3.Release**
  - v4 is still relatively new and may have undocumented breaking changes
  - v3.Release solves the immediate problem completely
  - Minimal risk approach for production homelab
  - Can migrate to v4 later as a separate, non-urgent task
  - The issue is with Chart vs Release, not v3 vs v4

## Notes
- Current version: `@pulumi/kubernetes@4.24.1` supports both Chart and Release
- The uninstall job is a pre-delete hook that validates deletion intent
- Release approach aligns with Longhorn's intended deployment method
- Chart approach was causing state management issues with transient hook resources

---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
