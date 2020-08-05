# istio-research: Ingress Feeder

Ingress Feeder gets Cloud Foundry route update messages from NATS and creates Istio Service Entries Kubernetes objects. One Ingress Feeder process runs per Cloud Foundry foundation / Istio Kubernetes cluster.

## Run Ingress Feeder

### On a laptop

Ingress Feeder needs two sets of environment variables

* One set contains endpoint and secrets to access NAT. Those variables can be sourced from APA Vault path `secret/apa/apps/ingress-feeder/nats/SITE`.
* Another set defines Kubernetes endpoint and token to access the target Istio Kubernetes cluster. The account should be able to read, create and update Service Entries. Required environment variables are `KUBE_SERVER`, `KUBE_TOKEN` and `KUBE_NAMESPACE`.

#### Start a local instance of the feeder

```shell
# Point `kubectl` to a desired Kubernetes cluster
# Example: `minikube start`
# Define which CF site to bind:
site=YOUR_SITE_OR_CF_TARGET
# Set Kubernetes service account and define environment variables to access Kubernetes
kubectl create serviceaccount ingress-feeder
kubectl create role ingress-feeder --resource=serviceentry --verb='*'
kubectl create rolebinding ingress-feeder --role=ingress-feeder --serviceaccount=istio-system:ingress-feeder
KUBE_NAMESPACE=istio-system
KUBE_SECRET_NAME=$(kubectl get serviceaccount ingress-feeder -ojsonpath='{.secrets[0].name}')
KUBE_SERVER=$(kubectl config view --minify --raw -ojsonpath='{.clusters[0].cluster.server}')
KUBE_TOKEN=$(kubectl get secret "$KUBE_SECRET_NAME" -ojson|jq -r '.data.token|@base64d')
export KUBE_NAMESPACE KUBE_SERVER KUBE_TOKEN
# Pull dependencies
npm install
# Run the feeder
npm start
```

#### Tear down

```shell
# Delete service account
kubectl delete serviceaccount,role,rolebinding ingress-feeder
unset KUBE_NAMESPACE KUBE_SERVER KUBE_TOKEN KUBE_SECRET_NAME
# Delete all service entries if needed
kubectl delete serviceentries --all
```

### Run in Kubernetes

In addition to the normal mode, there is a customization set to run Istio Feeder in minikube. The difference them is that minikube profile uses `dev` image tag and don't pull image from a registry if the image already present in minikube cluster. This is done to support quick local development and testing without pushing images to the registry.

#### Run

```shell
site=YOUR_SITE_OR_CF_TARGET
env=minikube # or production
# Create kubernetes secret containing NATS endpoint and credentials
# Define `NATS_PASSWORD`, `NATS_SERVERS`, and `NATS_USER` variables and run
kubectl create secret generic ingress-feeder-"$site"  \
  --from-literal=CF_SITE="$CF_SITE" \
  --from-literal=NATS_PASSWORD="$NATS_PASSWORD" \
  --from-literal=NATS_SERVERS="$NATS_SERVERS" \
  --from-literal=NATS_USER="$NATS_USER"
# Use Kustomize to deploy the application to the target cluster
kubectl apply --kustomize=kustomize/overlays/"$site-$env"
```

#### Tear down kubernetes deployment

```shell
site=us-east-1 # or us-west-1
env=minikube # or production
kubectl delete --kustomize=kustomize/overlays/"$site-$env"
# Delete all service entries if needed
kubectl delete serviceentries --all
```

## Build image

### Development

```shell
docker login
pack build DOCKERUSERNAME/Image:tag
```

### Production

```shell
docker login
pack build DOCKERUSERNAME/Image
docker push DOCKERUSERNAME/Image:tag
```

## Test

```shell
npm test
```
