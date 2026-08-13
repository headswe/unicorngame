// Infrastructure for the meadow relay.
//
// One Linux App Service plan and one web app. That is the whole thing — the
// relay keeps its state in a single small JSON file under /home, which App
// Service already gives us as persistent storage shared across restarts, so
// there is no database, no storage account and nothing else to pay for.
//
//   az group create --name rg-unicorngame-prod-001 --location swedencentral
//   az deployment group create -g rg-unicorngame-prod-001 -f infra/relay.bicep \
//     -p appName=app-unicorngame-prod-001 githubRepo=headswe/unicorngame
//
// It also creates the identity GitHub Actions signs in with, so there is no
// publish profile or password anywhere: GitHub proves who it is with a
// short-lived token and Azure trusts it for whatever `githubSubject` allows.

@description('Name of the web app. Becomes <appName>.azurewebsites.net, so it must be globally unique.')
@minLength(3)
@maxLength(50)
param appName string

@description('Where to put it. Somewhere near the children keeps the latency down.')
param location string = resourceGroup().location

@description('Which local day the meadow resets on. Must match MEADOW_TIMEZONE in src/game/day.ts.')
param timezone string = 'Europe/Stockholm'

@description('owner/repo allowed to deploy this. Anything else GitHub sends is refused.')
param githubRepo string = 'headswe/unicorngame'

@description('''
Which GitHub runs may assume this identity, as an OIDC subject claim.

Whatever is set here has to match, exactly, the claim a workflow run sends —
that is the whole of the check, so a typo reads as "access denied" rather than
as a typo. The usual shapes:

  repo:owner/repo:ref:refs/heads/<branch>   a single branch
  repo:owner/repo:environment:<name>        a named environment (the job then
                                            needs a matching `environment:`)
  repo:owner/repo:pull_request              pull requests
  repo:owner/repo:ref:refs/tags/<tag>       a single tag

Repositories created after 15 July 2026 send an *immutable* subject instead,
which carries the numeric owner and repository ids so that renaming or
transferring the repository does not silently break the trust:

  repo:owner@<owner-id>/repo@<repo-id>:ref:refs/heads/<branch>

Check which one this repository sends before assuming; the two look similar
enough to copy the wrong one, and the failure is an unhelpful "access denied".
The ids cannot be left out of the immutable form.

Defaulted to one branch because a template should start narrow. Widening it is
a fair choice for a private repository nobody else can push to — the identity
can only deploy this one app either way — but it should be a decision rather
than an accident.
''')
param githubSubject string = 'repo:${githubRepo}:ref:refs/heads/claude/unicorn-game-build-88xv4l'

@description('Name for the federated credential. Only has to be unique on the identity.')
param githubCredentialName string = 'github-relay'

@description('Node runtime for the relay. Only needs ESM and `ws`, so any current LTS is fine.')
param nodeVersion string = 'NODE|20-lts'

@description('''
B1 is the smallest that works, not a preference. WebSockets need Basic or
above, and Free and Shared cannot do Always On — without which the app unloads
between visits and the first child to arrive waits for a cold start.
''')
@allowed([
  'B1'
  'B2'
  'S1'
])
param sku string = 'B1'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  sku: {
    name: sku
  }
  kind: 'linux'
  properties: {
    // The flag that actually makes the plan Linux; `kind` alone does not.
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeVersion
      // Both of these are off by default and both are required. WebSockets are
      // the entire point, and without Always On the app unloads when idle.
      webSocketsEnabled: true
      alwaysOn: true
      // The lobby lives in one process's memory. A second instance would be a
      // second meadow that cannot see the first, so this must never scale out.
      numberOfWorkers: 1
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/healthz'
      appCommandLine: 'node relay.js'
      appSettings: [
        {
          name: 'ANGEN_TIMEZONE'
          value: timezone
        }
        {
          // /home is the persistent share; everything else is lost on a recycle.
          name: 'ANGEN_DATA_DIR'
          value: '/home/data'
        }
        {
          // Deployed as a built package, so Oryx should not try to build again.
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
      ]
    }
  }
}

// --- how GitHub Actions gets in -------------------------------------------
//
// A user-assigned identity plus a federated credential. GitHub presents a token
// saying "I am a run of this repository on this branch"; Azure checks that
// against the subject below and issues real access if it matches. Nothing
// long-lived is stored in the repository.

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'uami-github-${appName}'
  location: location
}

resource federated 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: githubCredentialName
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    // The subject is the entire check: a run whose claim does not match this
    // exactly gets nothing. See the parameter for the shapes it can take.
    subject: githubSubject
    audiences: ['api://AzureADTokenExchange']
  }
}

// Website Contributor rather than Contributor: enough to deploy and restart
// this one app, and nothing at all outside it.
var websiteContributor = 'de139f84-1756-47ae-9be6-808fbbe84772'

resource deployRights 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Scoped to the app, so the identity cannot touch anything else in the group.
  scope: app
  name: guid(app.id, identity.id, websiteContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      websiteContributor
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

@description('Paste this into the VITE_ANGEN_RELAY repository variable.')
output relayUrl string = 'wss://${app.properties.defaultHostName}/angen'

@description('Handy for checking it is up.')
output healthUrl string = 'https://${app.properties.defaultHostName}/healthz'

@description('GitHub secret AZURE_CLIENT_ID.')
output clientId string = identity.properties.clientId

@description('GitHub secret AZURE_TENANT_ID.')
output tenantId string = identity.properties.tenantId

@description('GitHub secret AZURE_SUBSCRIPTION_ID.')
output subscriptionId string = subscription().subscriptionId
