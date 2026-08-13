// Infrastructure for the meadow relay.
//
// One Linux App Service plan and one web app. That is the whole thing — the
// relay keeps its state in a single small JSON file under /home, which App
// Service already gives us as persistent storage shared across restarts, so
// there is no database, no storage account and nothing else to pay for.
//
//   az group create --name angen --location swedencentral
//   az deployment group create -g angen -f infra/relay.bicep -p appName=<globally-unique-name>
//
// The name has to be unique across all of azurewebsites.net, so something like
// `angen-relay-<something-of-yours>` rather than `angen`.

@description('Name of the web app. Becomes <appName>.azurewebsites.net, so it must be globally unique.')
@minLength(3)
@maxLength(50)
param appName string

@description('Where to put it. Somewhere near the children keeps the latency down.')
param location string = resourceGroup().location

@description('Which local day the meadow resets on. Must match MEADOW_TIMEZONE in src/game/day.ts.')
param timezone string = 'Europe/Stockholm'

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
      linuxFxVersion: 'NODE|20-lts'
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

@description('Paste this into the VITE_ANGEN_RELAY repository variable.')
output relayUrl string = 'wss://${app.properties.defaultHostName}/angen'

@description('Handy for checking it is up.')
output healthUrl string = 'https://${app.properties.defaultHostName}/healthz'
