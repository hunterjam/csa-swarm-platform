// infra/modules/cosmos.bicep
@description('Location for Cosmos DB account')
param location string

@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string = 'csa_swarm'

@description('Container name')
param containerName string = 'swarm'

@description('Subnet resource ID for the Cosmos DB private endpoint. When set, publicNetworkAccess is Disabled and traffic flows over private link (SFI-proof).')
param privateEndpointSubnetId string = ''

@description('VNet resource ID for private DNS zone VNet link. Required when privateEndpointSubnetId is set.')
param vnetId string = ''

var usePrivateEndpoint = !empty(privateEndpointSubnetId)

// ── Cosmos DB account (serverless, NoSQL) ───────────────────────────────
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true  // enforce Entra ID / managed identity
    publicNetworkAccess: usePrivateEndpoint ? 'Disabled' : 'Enabled'
    networkAclBypass: 'AzureServices'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: cosmosDb
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: ['/session_id']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }, { path: '/content/?' }]
      }
    }
  }
}

// ── Cosmos DB Built-in Data Contributor role assignment is handled in main.bicep
// to avoid a circular dependency with the backend module.

// ── Private endpoint (keeps Cosmos DB reachable when publicNetworkAccess=Disabled) ──
// When usePrivateEndpoint=true:
//   - Traffic from VNet-injected Container Apps resolves the Cosmos FQDN to a
//     private IP via the privatelink.documents.azure.com DNS zone.
//   - publicNetworkAccess is Disabled, so SFI policy enforcement no longer breaks us.
resource cosmosPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = if (usePrivateEndpoint) {
  name: '${accountName}-pe'
  location: location
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: '${accountName}-plsc'
        properties: {
          privateLinkServiceId: cosmosAccount.id
          groupIds: ['Sql']
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (usePrivateEndpoint) {
  name: 'privatelink.documents.azure.com'
  location: 'global'
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (usePrivateEndpoint) {
  parent: privateDnsZone
  name: '${accountName}-vnet-link'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnetId }
    registrationEnabled: false
  }
}

resource dnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = if (usePrivateEndpoint) {
  parent: cosmosPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos-zone-config'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}

output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseName string = databaseName
output cosmosContainerName string = containerName
output cosmosAccountId string = cosmosAccount.id
output cosmosAccountName string = cosmosAccount.name
