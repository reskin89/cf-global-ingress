process.env.NODE_ENV = 'test';

const chai = require('chai');
const chaiHttp = require('chai-http');
const k8scn = require('@kubernetes/client-node');
const app = require('../ingress-broker');

const kc = new k8scn.KubeConfig();
kc.loadFromDefault();
const k8sApiExtV1 = kc.makeApiClient(k8scn.CustomObjectsApi);

chai.use(chaiHttp);
const expect = chai.expect;

function getVirtualService() {
  return k8sApiExtV1.getNamespacedCustomObject(
    'networking.istio.io', 'v1beta1', 'default','virtualservices','foo.tld'
  )
}

describe('GET catalog', () => {
  it('should response with 200 and provide a json body containing a list of services', (done) => {
    chai.request(app)
      .get('/v2/catalog')
      .auth('foo', 'bar')
      .set('Accept', 'application/json')
      .end(function (err, res) {
        expect(res)
          .to.have.status(200)
          .to.be.json;
        expect(res.body)
          .to.be.an('object')
          .to.have.a.property('services')
        expect(res.body.services)
          .to.be.an('array')
          .to.be.not.empty;
        done();
      });
  });
});

describe('Multiple services share hostname "foo.tld"', () => {
  describe('Create service instance "foo"', () => {
    describe('Service Broker call', () => {
      it('should response with 201 and provide a json body', (done) => {
        chai.request(app)
          .put('/v2/service_instances/foo-service')
          .auth('foo', 'bar')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send({context: {}, service_id: 'foo', plan_id: 'bar', parameters: {fqdn: 'foo.tld'}})

          .end(function (err, res) {
            expect(res).to.have.status(201).to.be.json;
            expect(res.body).to.be.an('object');
            done();
          });
      });
    });

    describe('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should create Istio VirtualService',  (done) => {
        vs.then((vs) => {
            expect(vs.response.statusCode).to.be.equal(200);
            done();
          }).catch((err) => {done(err);})
      });

      it('the service should have annotation that keeps details of the service', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object');
          expect(vs.body.metadata.annotations['service-instance.cf-global-ingress.tld/foo-service']).to.be.a('string');
          done();
        }).catch(((err) => {done(err);}))
      });

      it('the service should have label "service-instance.cf-global-ingress.tld/foo-service: active"',  (done) => {
        vs.then((vs) => {
          expect(Object.keys(vs.body.metadata.labels))
            .to.have.lengthOf(1);
          expect(vs.body.metadata.labels['service-instance.cf-global-ingress.tld/foo-service'])
            .to.equal('active');
          done();
        }).catch((err) => {done(err);})
      });

    });
  })

  describe('Create service instance "bar" with the same fqdn as "foo"', () => {
    describe('Service Broker call', () => {
      it('should response with 201 and provide a json body', (done) => {
        chai.request(app)
          .put('/v2/service_instances/bar-service')
          .auth('foo', 'bar')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send({context: {}, service_id: 'foo', plan_id: 'bar', parameters: {fqdn: 'foo.tld'}})

          .end(function (err, res) {
            expect(res).to.have.status(201).to.be.json;
            expect(res.body).to.be.an('object');
            done();
          });
      });
    });

    describe('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should create Istio VirtualService',  (done) => {
        vs.then((vs) => {
          expect(vs.response.statusCode).to.be.equal(200);
          done();
        }).catch((err) => {done(err);})
      });

      it('the service should have annotation that keeps details of the service', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object');
          expect(vs.body.metadata.annotations['service-instance.cf-global-ingress.tld/bar-service']).to.be.a('string');
          done();
        }).catch(((err) => {done(err);}))
      });

      it('the service should have a new label "service-instance.cf-global-ingress.tld/bar-service: active"',  (done) => {
        vs.then((vs) => {
          expect(Object.keys(vs.body.metadata.labels)).to.have.lengthOf(2);
          expect(vs.body.metadata.labels['service-instance.cf-global-ingress.tld/bar-service']).to.equal('active');
          done();
        }).catch((err) => {done(err);})
      });

    });
  })

  describe('Delete service instance foo', () => {
    it('should response with 200 and an empty json body', (done) => {
      chai.request(app)
        .delete('/v2/service_instances/foo-service')
        .auth('foo', 'bar')
        .query({ accepts_incomplete: true })
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send()

        .end(function (err, res) {
          expect(res)
            .to.have.status(200)
            .to.be.json;
          expect(res.body)
            .to.be.an('object')
            .to.be.empty;
          done();
        });
    });

    describe('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should keep VirtualService alive',  (done) => {
        vs.then((vs) => {
          expect(vs.response.statusCode).to.be.equal(200);
          done();
        }).catch((err) => {done(err);})
      });

      it('the service should not have label "service-instance.cf-global-ingress.tld/foo-service"',  (done) => {
        vs.then((vs) => {
          expect(Object.keys(vs.body.metadata.labels)).to.have.lengthOf(1);
          expect(vs.body.metadata.labels).to.not.have.property('service-instance.cf-global-ingress.tld/foo-service');
          done();
        }).catch((err) => {done(err);})
      });

      it('the service should have label "service-instance.cf-global-ingress.tld/bar-service"',  (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.labels['service-instance.cf-global-ingress.tld/bar-service']).to.equal('active');
          done();
        }).catch((err) => {done(err);})
      });

      it('the service should not have annotation "service-instance.cf-global-ingress.tld/foo-service"',  (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.not.have.property('service-instance.cf-global-ingress.tld/foo-service');
          done();
        }).catch((err) => {done(err);})
      });

      it('the service should have annotation "service-instance.cf-global-ingress.tld/bar-service"',  (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations['service-instance.cf-global-ingress.tld/bar-service']).to.be.a('string');
          done();
        }).catch((err) => {done(err);})
      });

    });
  });

  describe('Delete service instance bar', () => {
    it('should response with 200 and an empty json body', (done) => {
      chai.request(app)
        .delete('/v2/service_instances/bar-service')
        .auth('foo', 'bar')
        .query({ accepts_incomplete: true })
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send()

        .end(function (err, res) {
          expect(res)
            .to.have.status(200)
            .to.be.json;
          expect(res.body)
            .to.be.an('object')
            .to.be.empty;
          done();
        });
    });

    it('should delete Istio VirtualService', (done) => {
      getVirtualService()
        .then((vs) => {
          done(new Error('VirtualService still present after deletion'));
        })
        .catch((err) => {
          expect(err.statusCode).to.be.equal(404);
          done();
        });
    });
  });

});


describe('Flow', () => {
  describe('Attempt to create an instance without `fqdn` parameter', () => {
    it('should fail with 400 response and provide a json body with the error description', (done) => {
      chai.request(app)
        .put('/v2/service_instances/foo-service')
        .auth('foo', 'bar')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send({
          context: {},
          service_id: 'foo',
          plan_id: 'bar'
        })

        .end(function (err, res) {
          expect(res)
            .to.have.status(400)
            .to.be.json;
          expect(res.body)
            .to.be.an('object')
            .to.have.a.property('description')
            .to.be.a('string');
          done();
        });
    });
  });

  describe('Create service instance', () => {
    describe('Service Broker call', () => {
      it('should response with 201 and provide a json body', (done) => {
        chai.request(app)
          .put('/v2/service_instances/foo-service')
          .auth('foo', 'bar')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send({
            context: {},
            service_id: 'foo',
            plan_id: 'bar',
            parameters: {
              fqdn: 'foo.tld'
            }
          })

          .end(function (err, res) {
            expect(res)
              .to.have.status(201)
              .to.be.json;
            expect(res.body)
              .to.be.an('object');
            done();
          });
      });
    });

    describe('Istio VirtualService', () => {
      it('should create Istio VirtualService',  (done) => {
        getVirtualService()
          .then((vs) => {
            expect(vs)
              .to.be.an('object')
              .to.have.a.property('response')
              .to.have.a.property('statusCode')
              .to.be.equal(200);
            expect(vs)
              .to.have.a.property('body')
              .to.have.a.property('spec');

            expect(vs.body.spec).to.have.a.property('gateways')
              .to.be.an('array').lengthOf(1)
              .to.include('cf-gateway');

            expect(vs.body.spec).to.have.a.property('gateways')
              .to.be.an('array').lengthOf(1)
              .to.include('cf-gateway');

            expect(vs.body.spec).to.have.a.property('hosts')
              .to.be.an('array').lengthOf(1)
              .to.include('foo.tld');

            expect(vs.body.spec).to.have.a.property('http')
              .to.be.an('array').lengthOf(1);
            done();
          })
          .catch((err) => {
            done(err);
          })
      });
    });
  });

  describe('Bind service to foo-app', () => {
    describe('Service Broker call', () => {
      it('should response with "201 Created" and provide a valid json body', (done) => {
        chai.request(app)
          .put('/v2/service_instances/foo-service/service_bindings/foo-binding')
          .auth('foo', 'bar')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send({
            bind_resource: {
              app_guid: 'foo-app-guid'
            }
          })

          .end(function (err, res) {
            expect(res)
              .to.have.status(201)
              .to.be.json;
            expect(res.body)
              .to.be.an('object');
            done();
          });
      });
    });

    describe('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should have a new routing record', (done) => {
        vs.then((vs) => {
          expect(vs.body.spec.http).to.be.an('array').lengthOf(2);
          done();
        }).catch((err) => done(err));
      });

      it('should have a route to "foo-app"', (done) => {
        vs.then((vs) => {
          expect(vs.body.spec.http[1]).to.be.deep.equals({
            route: [{
              destination: {host: 'foo-app-guid.cluster.local'},
              weight: 100
            }]});
          done();
        }).catch((err) => done(err));
      });

      it('should have an annotation to map "foo-app" binding to "foo-app" guid', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object')
            .with.property('apa.MYDOMAIN.net/foo-binding').valueOf('foo-app-guid')
          done();
        }).catch((err) => done(err));
      });

      it('should have an annotation containing binding details', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object')
            .with.property('service-binding.apa.MYDOMAIN.net/foo-binding');
          done();
        }).catch((err) => done(err));
      });
    });
  });

  describe('Bind service to bar-app with "weight" = 10', (done) => {
    describe('Service Broker call', () => {
      it('should response with 201 and provide a json body', (done) => {
        chai.request(app)
          .put('/v2/service_instances/foo-service/service_bindings/bar-binding')
          .auth('foo', 'bar')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send({
            bind_resource: {app_guid: 'bar-app-guid'},
            parameters: {weight: 10}
          })

          .end(function (err, res) {
            expect(res)
              .to.have.status(201)
              .to.be.json;
            expect(res.body)
              .to.be.an('object');
            done();
          });
      });
    });

    describe('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should have a new routing record', (done) => {
        vs.then((vs) => {
          expect(vs.body.spec.http).to.be.an('array').lengthOf(2);
          expect(vs.body.spec.http[1].route).to.be.an('array').lengthOf(2);
          done();
        })
          .catch((err) => done(err));
      });

      it('should have a route to "bar-app" with "weight" = 10', (done) => {
        vs.then((vs) => {
          expect(vs.body.spec.http[1].route[1]).to.eql({
            destination: {host: 'bar-app-guid.cluster.local'},
            weight: 10
          });
          done();
        })
          .catch((err) => done(err));
      });

      it('should update weitht route to "foo-app" with to 90', (done) => {
        vs.then((vs) => {
          expect(vs.body.spec.http[1].route[0]).to.eql({
            destination: {host: 'foo-app-guid.cluster.local'},
            weight: 90
          });
          done();
        })
          .catch((err) => done(err));
      });

      it('should have an annotation to map "bar-app" binding to "bar-app" guid', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations)
            .to.be.an('object')
            .with.property('apa.MYDOMAIN.net/bar-binding')
            .valueOf('bar-app-guid')
          done();
        })
          .catch((err) => done(err));
      });

      it('should have an annotation containing "foo-binding" details', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object')
            .with.property('service-binding.apa.MYDOMAIN.net/bar-binding');
          done();
        }).catch((err) => done(err));
      });
    });
  });

  describe('Unbind service from foo-app', () => {
    describe('Service Broker call', () => {
      it('should response with 200 and an empty json body', (done) => {
        chai.request(app)
          .delete('/v2/service_instances/foo-service/service_bindings/foo-binding')
          .auth('foo', 'bar')
          .query({accepts_incomplete: true})
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send()

          .end(function (err, res) {
            expect(res)
              .to.have.status(200)
              .to.be.json;
            expect(res.body)
              .to.be.an('object')
              .to.be.empty;
            done();
          });
      });
    });

    describe ('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should update VirtualService by removing a route to "foo-app"', (done) => {
        vs.then((vs) => {
            expect(vs.response.statusCode).to.be.equal(200);
          expect(vs.body.spec.http[1].route).to.be.an('array').lengthOf(1);
            expect(vs.body.spec.http[1].route[0].destination).to.be.eqls({host: 'bar-app-guid.cluster.local'});
            done();
          })
          .catch((err) => {
            done(err);
          })
      });

      it('should set weight of "bar-app" route to 100', (done) => {
        vs.then((vs) => {
            expect(vs.body.spec.http[1].route[0].weight).equals(100);
            done();
          })
          .catch((err) => {done(err);}
        );
      });

      it('should remove annotation for "foo-app" binding', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations)
            .to.be.an('object')
            .to.not.have.property('apa.MYDOMAIN.net/foo-binding')
          done();
        }).catch((err) => done(err));
      });

      it('should remove annotation containing "foo-binding" details', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object')
            .to.not.have.property('service-binding.apa.MYDOMAIN.net/foo-binding');
          done();
        }).catch((err) => done(err));
      });
    });
  });

  describe('Unbind service from bar-app', () => {
    describe('Service Broker call', () => {
      it('should response with 200 and an empty json body', (done) => {
        chai.request(app)
          .delete('/v2/service_instances/foo-service/service_bindings/bar-binding')
          .auth('foo', 'bar')
          .query({accepts_incomplete: true})
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .send()

          .end(function (err, res) {
            expect(res)
              .to.have.status(200)
              .to.be.json;
            expect(res.body)
              .to.be.an('object')
              .to.be.empty;
            done();
          });
      });
    });

    describe ('Istio VirtualService', () => {
      let vs;
      before(() => {vs = getVirtualService();});

      it('should update VirtualService by removing a route to "bar-app"', (done) => {
        vs.then((vs) => {
            expect(vs.response.statusCode).to.be.equal(200);
            expect(vs.body.spec.http.length).to.be.equal(1);
            done();
          })
          .catch((err) => done(err));
      });

      it('should remove annotation for "bar-app" binding', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.not.have.property('apa.MYDOMAIN.net/bar-binding');
          done();
        }).catch((err) => done(err));
      });

      it('should remove annotation containing "bar-binding" details', (done) => {
        vs.then((vs) => {
          expect(vs.body.metadata.annotations).to.be.an('object')
            .to.not.have.property('service-binding.apa.MYDOMAIN.net/bar-binding');
          done();
        }).catch((err) => done(err));
      });
    });
  });

  describe('Delete service instance', () => {
    it('should response with 200 and an empty json body', (done) => {
      chai.request(app)
        .delete('/v2/service_instances/foo-service')
        .auth('foo', 'bar')
        .query({ accepts_incomplete: true })
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send()

        .end(function (err, res) {
          expect(res)
            .to.have.status(200)
            .to.be.json;
          expect(res.body)
            .to.be.an('object')
            .to.be.empty;
          done();
        });
    });

    it('should delete Istio VirtualService', (done) => {
      getVirtualService()
        .then((vs) => {
          done(new Error('VirtualService still present after deletion'));
        })
        .catch((err) => {
          expect(err.statusCode).to.be.equal(404);
          done();
        });
    });
  });
});
