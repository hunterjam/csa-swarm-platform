// infra/modules/containerapp.bicep
@description('Container Apps Environment resource ID')
param environmentId string

@description('Container app name')
param appName string

@description('Location')
param location string

@description('Container image (registry/image:tag)')
param image string

@description('Target port exposed by the container')
param targetPort int

@description('ACR login server for managed-identity pull (e.g. myacr.azurecr.io)')
param registryServer string = ''

@description('Environment variables')
param env array = []

@description('CPU cores (0.5, 1, 2)')
param cpu string = '0.5'

@description('Memory (1Gi, 2Gi)')
param memory string = '1Gi'

@description('Minimum replicas')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 5

@description('azd service name tag (used by azd deploy to locate this app)')
param azdServiceName string = ''

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: empty(azdServiceName) ? {} : { 'azd-service-name': azdServiceName }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: environmentId
    configuration: {
      registries: empty(registryServer) ? [] : [
        {
          server: registryServer
          identity: 'system'
        }
      ]
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: env
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
    }
  }
}

output principalId string = app.identity.principalId
output fqdn string = app.properties.configuration.ingress.fqdn
