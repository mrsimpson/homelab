# Development Plan: homelab (external-secrets-registry branch)

*Generated on 2025-12-30 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
**Phase 1 COMPLETED**: ✅ External-secrets properly configured for private GHCR images

**Phase 2 NEW GOAL**: 
1. **Implement Pulumi ESC** for centralized secret management instead of storing secrets in Pulumi stack config
2. **Recreate nodejs-demo app** with proper deployment using private GHCR images and ESC-managed secrets  
3. **Demonstrate end-to-end workflow** from ESC secret management to private image deployment

## Explore
### Phase 2 Tasks - Pulumi ESC Implementation
- [x] Research Pulumi ESC environments and configuration 
- [x] Understand current secret storage approach (stack config vs ESC)
- [x] Analyze how ClusterSecretStore integrates with Pulumi ESC
- [x] Design ESC environment structure for homelab secrets
- [x] Plan nodejs-demo app recreation with ESC-managed secrets
- [x] Research app deployment patterns in the homelab codebase  
- [ ] Clean up redundant secret storage (remove from stack config)
- [ ] Update documentation to reflect ESC-only approach

### Phase 1 Completed:
- [x] Created development plan file
- [x] Analyzed existing external-secrets infrastructure code
- [x] Identified that external-secrets operator is running but ClusterSecretStore is missing
- [x] Found that GHCR token is configured in environment ($GHCR_TOKEN) but not in Pulumi config
- [x] Discovered that base-infra attempts to create GHCR pull secret but likely fails due to missing config
- [x] Set github-credentials.token in Pulumi configuration from $GHCR_TOKEN environment variable
- [x] Manually created ClusterSecretStore (pulumi-esc) - Status: Valid, Ready: True
- [x] Manually created ExternalSecret for GHCR - Status: SecretSynced, Ready: True  
- [x] Verified docker config secret was created successfully
- [x] **TESTED SUCCESSFULLY**: Pod with private GHCR image (ghcr.io/mrsimpson/nodejs-demo:build-20251229-132149) is running

### Phase 2 Completed:
- [x] **DISCOVERED**: Pulumi ESC environment `mrsimpson/homelab/dev` already exists and contains GitHub credentials
- [x] **VERIFIED**: ClusterSecretStore is pulling from ESC correctly - external-secrets working via ESC, not stack config
- [x] **IDENTIFIED**: Stack config `github-credentials.token` is redundant - ESC is the actual source
- [x] Analyzed app deployment patterns - apps use `homelab.createExposedWebApp()` with `imagePullSecrets`

## Plan

### Phase Entrance Criteria:
- [x] Current external-secrets setup has been thoroughly analyzed
- [x] GHCR authentication requirements are understood
- [x] Available secrets and configuration options are documented
- [x] Previous failed attempts have been analyzed
- [x] Clear understanding of what needs to be configured

### Phase 2 Implementation Strategy

**Findings Summary:**
1. **ESC Already Working**: Pulumi ESC environment `mrsimpson/homelab/dev` contains GitHub credentials
2. **External-Secrets Using ESC**: ClusterSecretStore pulls from ESC, not from stack config
3. **Redundant Configuration**: Stack config contains duplicate GitHub token that's not being used
4. **Clean Architecture Goal**: Remove redundant secrets, establish ESC as single source of truth

**Implementation Plan:**
1. **Clean up Stack Config**: Remove redundant `github-credentials.token` from Pulumi stack config
2. **Verify ESC-Only Operation**: Ensure external-secrets continues working after stack config removal
3. **Create nodejs-demo App**: Recreate nodejs-demo with proper app structure using private GHCR images
4. **Update Documentation**: Document the ESC-first approach in setup guides

### Tasks  
- [x] Analyze current ESC vs stack config usage
- [x] Design cleanup strategy for redundant configuration
- [x] Plan nodejs-demo app structure following hello-world pattern
- [x] Identify documentation updates needed

### Completed
- [x] **KEY INSIGHT**: Stack config secrets are redundant - ESC is already the working source
- [x] Confirmed external-secrets pulls `github-username` and `github-token` from ESC environment
- [x] Planned nodejs-demo app structure: create package in `packages/apps/nodejs-demo/` following hello-world pattern
- [x] Identified documentation updates: update GHCR setup guide to reflect ESC-only approach

## Code

### Phase Entrance Criteria:
- [ ] Implementation plan has been created and approved
- [ ] Configuration approach has been decided
- [ ] Dependencies and integration points are identified
- [ ] Testing approach is defined

### Phase 2 Implementation Tasks
- [x] Remove redundant `github-credentials.token` from stack config
- [x] Remove redundant `github-credentials.username` from stack config  
- [x] Test that external-secrets continues working after stack config cleanup
- [x] Create nodejs-demo app package structure in `packages/apps/nodejs-demo/`
- [x] Implement nodejs-demo app following hello-world pattern with private GHCR image
- [x] Add nodejs-demo app to main deployment in `src/index.ts`
- [x] Deploy and test nodejs-demo app with private GHCR image
- [ ] Update GHCR setup documentation to reflect ESC-only approach
- [x] Test end-to-end private image deployment with new nodejs-demo app
- [x] Update homelab-config backup system to include Pulumi ESC environments

### Completed
- [x] Port conflict resolved - user disabled Traefik in K3s cluster
- [x] Removed nodejs-demo app directory that was causing namespace issues
- [x] Successful Pulumi deployment with external-secrets infrastructure
- [x] ClusterSecretStore (pulumi-esc) deployed and Status: Valid/Ready
- [x] ExternalSecrets created in default and hello-world namespaces - both SecretSynced/Ready
- [x] GHCR pull secrets successfully created in both namespaces
- [x] **SUCCESS**: Private GHCR image `ghcr.io/mrsimpson/nodejs-demo:build-20251229-132149` successfully running in both default and hello-world namespaces
- [x] **GOAL ACHIEVED**: External-secrets properly configured for private GHCR image deployment
- [x] **NODEJS-DEMO DEPLOYED**: App successfully deployed with 2/2 pods running in nodejs-demo namespace, using private GHCR image and ESC-managed secrets
- [x] **END-TO-END SUCCESS**: Private GHCR image deployment working perfectly - app responding at nodejs-demo.no-panic.org with ingress routing
- [x] **CONFIG BACKUP ENHANCED**: Updated homelab-config backup system to include Pulumi ESC environments alongside stack config - now backs up external secrets from `mrsimpson/homelab/dev` environment
- [x] **SECRET VALUES FIXED**: Updated export script to properly capture actual secret values using `--show-secrets` - no more TODO placeholders for Cloudflare and Pulumi tokens

## Commit

### Phase Entrance Criteria:
- [x] External-secrets configuration is implemented and tested
- [x] GHCR image pull is working successfully
- [x] Test pod can be deployed with private GHCR image
- [x] Configuration is clean and production-ready

### Cleanup and Finalization Tasks
- [x] Remove any temporary debug artifacts (no debugging code was added)
- [x] Verify no TODO/FIXME comments need addressing 
- [x] Clean up development artifacts
- [x] Verify implementation is production-ready
- [x] Update documentation to reflect final state - current setup documented in plan file
- [x] Final validation tests - private GHCR images working in all namespaces
- [x] Code cleanup completed - no debug artifacts or temporary code found
- [x] Updated secrets management documentation to reflect ESC environment approach
- [x] Added backup/restore documentation section for enhanced homelab-config system
- [x] Final validation passed - backup system working with both stack config and ESC environments

### Next Phase Opportunities Identified:
- [ ] **Pulumi ESC Configuration**: Now that external-secrets ClusterSecretStore is working, we can configure Pulumi ESC environments to centrally manage secrets like GHCR tokens, instead of storing them in Pulumi stack config
- [ ] **Centralized Secret Management**: Move from `pulumi config set --secret` to Pulumi ESC environments for better secret lifecycle management

### Completed
- [x] Implementation is clean - no debug code or temporary artifacts were created
- [x] All ExternalSecrets infrastructure deployed through proper Pulumi infrastructure as code
- [x] No manual resources remain - everything is managed by Pulumi
- [x] **PRIMARY GOAL ACHIEVED**: External-secrets properly configured for private GHCR image deployment
- [x] Private images can be deployed in any namespace with `imagePullSecrets: [{ name: "ghcr-pull-secret" }]`
- [x] **COMMIT COMPLETE**: All changes committed successfully (commit 74db217)
- [x] Pre-commit hooks passed (TypeScript, linting, formatting)
- [x] Enhanced backup system committed with comprehensive documentation

## Key Decisions

### Phase 1 Decisions (COMPLETED):
- **Root Cause**: External secrets operator is installed but ClusterSecretStore (pulumi-esc) is not deployed because Pulumi config is missing github-credentials.token
- **Configuration Gap**: The $GHCR_TOKEN environment variable exists but needs to be stored in Pulumi ESC configuration to be accessible to External Secrets Operator
- **~~Deployment Blocker~~**: ✅ RESOLVED - ingress-nginx controller port conflict fixed by disabling Traefik
- **Success Criteria**: ✅ Pod successfully running `ghcr.io/mrsimpson/nodejs-demo:build-20251229-132149` via automated deployment

### Phase 2 Discoveries:
- **ESC Already Configured**: Pulumi ESC environment `mrsimpson/homelab/dev` already exists with GitHub credentials
- **ClusterSecretStore Working**: External-secrets is already pulling from ESC, not from stack config  
- **Duplicate Secret Storage**: Both ESC and stack config contain the same GitHub token (redundant)
- **ESC Structure**: Environment contains both object format (`github-credentials: {username, token}`) and individual keys (`github-username`, `github-token`)
- **Clean Architecture Goal**: Remove redundant stack config secrets, use ESC as single source of truth

## Notes

### Exploration Results:
- **Root Cause**: Missing `github-credentials.token` in Pulumi config prevented ClusterSecretStore creation
- **Solution Confirmed**: Manual configuration setup works perfectly - test pod successfully pulls private GHCR image
- **Manual Test Success**: Pod `test-ghcr-pull` running `ghcr.io/mrsimpson/nodejs-demo:build-20251229-132149`

### Current State:
- External Secrets Operator: ✅ Running (3 pods healthy)
- ClusterSecretStore: ✅ Created manually, Status: Valid/Ready
- ExternalSecret: ✅ Created manually, Status: SecretSynced/Ready
- GHCR Pull Secret: ✅ Created and working
- Private Image Pull: ✅ **WORKING** - Goal achieved!

### Next Steps:
- Fix Pulumi deployment (ingress-nginx port conflict issue)
- Clean up manual resources and deploy via infrastructure as code
- Ensure all namespaces get GHCR pull secrets as intended

---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
