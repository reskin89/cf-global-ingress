# APA Ingress Service Broker

The app is deployed to Kubernetes Cluster.  It can be tested against with a local application such as Minikube if desired, please make sure `kubectl` is configured for the target cluster prior to testing and building.

## Build proxy app

```console
make
```

## Deploy to the target Kubernetes cluster

Ingress definition needs customization. TBD: parameterize

```console
make deploy
```

## All make targets

* `all` - test the code, build Docker image, push the image to Docker registry and deploy the broker to the target Kubernetes cluster
  * `image-name` - required argument to name the resulting built and pushed docker image, e.g. `make build-image image-name=hub.docker.com/mynamespace/myimagename`
* `test` - test the app locally. Test requires Kubernetes cluster with Istio CRDs (Istio itself is not needed). The test creates Istio objects in `default` namespace and cleans it up after test run.
* `build-image` - build Docker image. Access to Docker engine is needed. Local Docker or Minikube work.
  * `image-name` - required argument to name the resulting docker image, e.g. `make build-image image-name=hub.docker.com/mynamespace/myimagename`
* `push-image` - Push image to the Docker registry. Login to the registry before tun.
  * `image-name` - required argument to push the resulting docker image from `make build-image`, e.g. `make push-image image-name=hub.docker.com/mynamespace/myimagename`
* `deploy` - deploy service broker to Kubernetes cluster.
* `clean` - remove cached dependencies`node_modules`.
