const express = require('express');
const bodyParser = require('body-parser');
const k8scn = require('@kubernetes/client-node');
const { getMaxListeners } = require('./logging');

const port = process.env.PORT || 8080;
const tld = process.env.TLD || 'cluster.local'
const ns = process.env.NAMESPACE || 'default'

const app = express();
const kc = new k8scn.KubeConfig();
kc.loadFromDefault();
const k8sApiExtV1 = kc.makeApiClient(k8scn.CustomObjectsApi);

const dummyRoute = [{
  match: [{uri: {prefix: '/dummy'}}],
  route: [{destination: {host: 'dummy.tld'}}]
}];

if (process.env.NODE_ENV !== 'test') {
  app.use(require('./logging'));
}
app.use(bodyParser.json());

function getVirtualService(instance_id) {
  return new Promise((resolve, reject) => {
    k8sApiExtV1.listNamespacedCustomObject(
      'networking.istio.io', 'v1beta1', ns, 'virtualservices',
      undefined, undefined, undefined, `service-instance.cf-global-ingress.tld/${instance_id}=active`
    ).then((vsl) => {
      if (vsl.body.items.length === 0) {
        reject({statusCode: 404, description: 'Virtual Service instance not found'});
      } else if (vsl.body.items.length > 1) {
        reject({statusCode: 500, description: 'Found more than one Virtual Service instance'});
      } else {
        resolve({body: vsl.body.items[0]});
      }
    }).catch((err) => {reject({statusCode: 500, description: err});});
  });
}

function getVirtualServiceByName(name) {
  return Promise.resolve(k8sApiExtV1.getNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', ns, 'virtualservices', name
  ));
}

function patchVirtualService(name, body) {
  const options = {headers: {'content-type': 'application/json-patch+json'}};
  return k8sApiExtV1.patchNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', ns, 'virtualservices', name, body,
    undefined, undefined, undefined, options
  )
}

function patchIngressService(body) {
  const options = {headers: {'content-type': 'application/json-patch+json'}};
  return k8sApiExtV1.patchNamespacedCustomObject(
    'networking.istio.io', 'v1alpha3', ns, 'gateways', 'mygateway', body,
    undefined, undefined, undefined, options
  )
}

function getIngressServices() {
  return k8sApiExtV1.getNamespacedCustomObject(
    'networking.istio.io', 'v1alpha3', ns, 'gateways', 'mygateway'
  );
}

function getIngressServiceByName(name) {
  return k8sApiExtV1.getNamespacedCustomObject(
    'networking.istio.io', 'v1alpha3', ns, 'gateways', 'mygateway'
  );
}

// Get Catalog
app.get('/v2/catalog', (req, res) => {
  const catalog = require('./catalog');
  res.send(catalog);
});

// Create service instance
app.put('/v2/service_instances/:instance_id', (req, res) => {
  // Service Broker request should contain `fqdn` in `parameters` section
  if (typeof req.body.parameters !== 'object' || typeof req.body.parameters.fqdn !== 'string') {
    res.status(400).send({
      error: 'RequiresFqdn',
      description: 'The request body is missing the `fqdn` parameter'
    });
    return;
  }

  getVirtualServiceByName(req.body.parameters.fqdn)
    .then((vs) => {
      return patchVirtualService(req.body.parameters.fqdn, [
        {
          op: 'add',
          path: `/metadata/labels/service-instance.cf-global-ingress.tld~1${req.params.instance_id}`,
          value: 'active'
        },
        {
          op: 'add',
          path: `/metadata/annotations/service-instance.cf-global-ingress.tld~1${req.params.instance_id}`,
          value: JSON.stringify(req.body)
        }
      ])
    })
    .catch((err) => {
      if(err.statusCode === 404) {
        let virtualService = {
          apiVersion: 'networking.istio.io/v1beta1',
          kind: 'VirtualService',
          metadata: {
            name: req.body.parameters.fqdn,
            annotations: {},
            labels: {}
          },
          spec: {
            gateways: ['cf-gateway'],
            hosts: [
              req.body.parameters.fqdn
            ],
            http: dummyRoute
          }
        };
        virtualService.metadata.labels[`service-instance.cf-global-ingress.tld/${req.params.instance_id}`] = 'active';
        virtualService.metadata.annotations[`service-instance.cf-global-ingress.tld/${req.params.instance_id}`] = JSON.stringify(req.body);

        return k8sApiExtV1.createNamespacedCustomObject(
          'networking.istio.io',
          'v1beta1',
          ns,
          'virtualservices',
          virtualService
        )
      } else {
        return patchVirtualService(req.body.parameters.fqdn, [
          {op: 'add', path: `/metadata/labels/["service-instance.cf-global-ingress.tld/${req.params.instance_id}"]`, value: 'active'}
        ])
      }
    })
    .then(() => {
      return getIngressServices()
    })
    .then((is) => {
      const exists = is.body.spec.servers.find(({ port }) => port.name === req.body.parameters.fqdn)

      if ( typeof exists !== 'undefined') {
        return
      } else {
        return patchIngressService(
          [
            {
              op: 'add', 
              path: '/spec/servers/-', 
              value: {
                port: {
                  number: 443,
                  name: req.body.parameters.fqdn,
                  protocol: "HTTPS"
                },
                hosts: [
                  req.body.parameters.fqdn
                ],
                tls: {
                  credentialName: "defaultSSLCertificate",
                  mode: "SIMPLE"
                }
              }
            }
          ]
       )
      }
    })
    .then(() => {
      res.status(201).send({});
    })
    .catch((err) => {
      console.error('ERROR: ', err.body.message);
      let code;
      if(err.statusCode === 409) {code = 409}
      else {code = 500}
      res.status(code).send({
        description: err.body.message
      });
    });
});

// Delete service instance
app.delete('/v2/service_instances/:instance_id', (req, res) => {
  getVirtualService(req.params.instance_id)
    .then((vs) => {
      let labels = vs.body.metadata.labels;
      delete labels[`service-instance.cf-global-ingress.tld/${req.params.instance_id}`];

      if (
        Object.entries(labels)
          .map((i) => i[0])
          .filter((i) => i.startsWith('service-instance.cf-global-ingress.tld/'))
          .length === 0
      ) {
        return k8sApiExtV1.deleteCollectionNamespacedCustomObject_2(
          'networking.istio.io',
          'v1beta1',
          ns,
          'virtualservices',
          vs.body.metadata.name
        )
      } else {
        return patchVirtualService(vs.body.metadata.name, [
          {op: 'remove', path: `/metadata/labels/service-instance.cf-global-ingress.tld~1${req.params.instance_id}`},
          {op: 'remove', path: `/metadata/annotations/service-instance.cf-global-ingress.tld~1${req.params.instance_id}`}
        ])
      }
    })
    .then((resp) => {
      if (!resp.body.hasOwnProperty('details')){
        return
      }
      let services = getIngressServices().then((result) => { return result }).catch((err) => { console.log("***INGRESS SERVICE ERRROR:", err) } )
      let serverArray = services.then((res) => { return res })
      let virtualServices = getVirtualServiceByName("foo.tld").then((res) => { return res }).catch((err) => { 
        serverArray.then((theData) => {
          theData.body.spec.servers.forEach((server, index) => {
            if (server.port.name === resp.body.details.name) {
              return patchIngressService([{op: 'remove', path: `/spec/servers/${index}`}])
            }
          })
        })
       })
      return
    })
    .then(() => {
      res.status(200).send({})
    })
    .catch(err => {
      console.error('ERROR: ', err.body.message);
      res.status(500).send({
        description: 'Unable to delete service instance'
      })
    });
});

// Create binding
app.put('/v2/service_instances/:instance_id/service_bindings/:binding_id', (req, res) => {
  // Service Broker request must contain `bind_resource.app_guid`
  if (typeof req.body.bind_resource !== 'object' || typeof req.body.bind_resource.app_guid !== 'string') {
    res.status(422).send({
      error: 'RequiresApp',
      description: 'The request body is missing the app_guid field'
    });
    return;
  }

  let weight = 50;
  if (typeof req.body.parameters == 'object') {
    if (typeof req.body.parameters.weight == 'number') {
      weight = req.body.parameters.weight;
    } else {
      res.status(422).send({
        error: 'MalformedParameter',
        description: 'Parameter "weight" must be an integer'
      });
      return;
    }
  }

  getVirtualService(req.params.instance_id)
    .then((vs) => {
      if (vs.body.spec.http.length === 1) {
        vs.body.spec.http.push({route: []})
      }
      let routes = vs.body.spec.http[1].route;

      let newWeight = 100;
      if (routes.length > 0) {
        newWeight = weight + (100 - weight) % (routes.length)
      }
      for (let i = 0; i < routes.length; i++) {
        routes[i].weight = (100 - newWeight) / (routes.length);
      }
      routes.push({
        destination: {
          host: `${req.body.bind_resource.app_guid}.${tld}`,
        },
        weight: newWeight
      });
      vs.body.spec.http[1].route = routes;

      return patchVirtualService(vs.body.metadata.name, [{
        op: 'replace',
        path: '/spec/http',
        value: vs.body.spec.http
      }])
    })
    .then((vs) => {
      annotations = vs.body.metadata.annotations
      if (typeof annotations === 'undefined') {annotations = {}}
      annotations[`apa.MYDOMAIN.net/${req.params.binding_id}`] = req.body.bind_resource.app_guid;
      annotations[`service-binding.apa.MYDOMAIN.net/${req.params.binding_id}`] = JSON.stringify(req.body);

      return patchVirtualService(vs.body.metadata.name, [
        {op: 'add', path: '/metadata/annotations', value: annotations}
      ])
    })
    .then(() => res.status(201).send({}))
    .catch((err) => {
      console.error('ERROR: ', err)
      res.status(500).send({
        description: err.toString()
      });
    });
});

// Delete binding
app.delete('/v2/service_instances/:instance_id/service_bindings/:binding_id', (req, res) => {
  getVirtualService(req.params.instance_id)
    .then((vs) => {
      let appGuid = vs.body.metadata.annotations[`apa.MYDOMAIN.net/${req.params.binding_id}`];

      let routes = vs.body.spec.http[1].route.filter(
        r => r.destination.host !== `${appGuid}.${tld}`
      );
      for (let i = 0; i < routes.length; i++) {
        routes[i].weight = 100 / routes.length
      }

      let rules = vs.body.spec.http;
      if (routes.length === 0) {
        rules = rules.filter((v, i) => i !== 1);
      } else {
        rules[1] = {route: routes};
      }

      return patchVirtualService(vs.body.metadata.name, [
        {op: 'replace', path: '/spec/http', value: rules},
        {op: 'remove', path: `/metadata/annotations/apa.MYDOMAIN.net~1${req.params.binding_id}`},
        {op: 'remove', path: `/metadata/annotations/service-binding.apa.MYDOMAIN.net~1${req.params.binding_id}`}
      ])
    })
    .then(() => res.status(200).send({}))
    .catch((err) => {
      console.error('ERROR: ', err)
      res.status(500).send({
        description: err.toString()
      });
    });
});

if (module.parent === null) {
  app.listen(port, () => console.log(`Bound to 0.0.0.0:${port}`));
}

module.exports = app;
