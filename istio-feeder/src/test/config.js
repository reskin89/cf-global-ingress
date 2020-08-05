const chai = require('chai');
const mock = require('mock-fs');
const expect = chai.expect;
const config = require('../config');

describe('Get Kubernetes API Endpoint', () => {
    before(() => {
        // Clean up env variables if they are set in the parent shell
        delete process.env.KUBE_SERVER;
        delete process.env.KUBE_CA;
        delete process.env.KUBE_TOKEN;
        delete process.env.KUBE_NAMESPACE;
    });
    describe('In-cluster configuration', () => {
        before(() => mock({
            '/run/secrets/kubernetes.io/serviceaccount': {
                'namespace': 'in-cluster-namespace',
                'token': 'in-cluster-token',
                'ca.crt': 'in-cluster-cert'
            }
        }));
        after(() => mock.restore());
        before(() => {
            process.env.KUBERNETES_SERVICE_HOST = 'in-cluster-server';
            process.env.KUBERNETES_SERVICE_PORT = '8443';
        });
        after(() => {
            delete process.env.KUBERNETES_SERVICE_HOST;
            delete process.env.KUBERNETES_SERVICE_PORT;
        });

        it('should get token from cluster service account', () => {
            expect(config.getK8sToken()).to.equal('in-cluster-token');
        });
        it('should get server from cluster service account', () => {
            expect(config.getK8sServer()).to.equal('https://in-cluster-server:8443');
        });
        it('should get CA from cluster service account', () => {
            expect(config.getK8sCA()).to.equal('in-cluster-cert');
        });
        it('should get namespace from cluster service account', () => {
            expect(config.getK8sNamespace()).to.equal('in-cluster-namespace');
        });
    });

    describe('Configure using environment variables KUBE_*', () => {
        before(() => {
            process.env.KUBE_SERVER = 'https://env-server:443';
            process.env.KUBE_CA = 'env-cert';
            process.env.KUBE_TOKEN = 'env-token';
            process.env.KUBE_NAMESPACE = 'env-namespace';
        });
        after(() => {
            delete process.env.KUBE_SERVER;
            delete process.env.KUBE_CA;
            delete process.env.KUBE_TOKEN;
            delete process.env.KUBE_NAMESPACE;
        });

        it('should get token from env variable KUBE_TOKEN', () => {
            expect(config.getK8sToken()).to.equal('env-token');
        });
        it('should get server from env variable KUBE_SERVER', () => {
            expect(config.getK8sServer()).to.equal('https://env-server:443');
        });
        it('should get CA from env variable KUBE_CA', () => {
            expect(config.getK8sCA()).to.equal('env-cert');
        });
        it('should get namespace from env variable KUBE_NAMESPACE', () => {
            expect(config.getK8sNamespace()).to.equal('env-namespace');
        });
    });

    describe('Default values', () => {
        it('should not be able to get token', () => {
            expect(config.getK8sToken()).to.be.an('undefined');
        });
        it('should not be able to get server', () => {
            expect(config.getK8sServer()).to.be.an('undefined');
        });
        it('should return "undefined" CA to skip server validation', () => {
            expect(config.getK8sCA()).to.be.an('undefined');
        });
        it('should get get default namespace', () => {
            expect(config.getK8sNamespace()).to.equal('default');
        });
    });

    describe('Get Axios config object', () => {
        describe('with supplied CA', () => {
            before(() => {
                process.env.KUBE_SERVER = 'https://env-server:443';
                process.env.KUBE_CA = 'env-cert';
                process.env.KUBE_TOKEN = 'env-token';
            });
            after(() => {
                delete process.env.KUBE_SERVER;
                delete process.env.KUBE_CA;
                delete process.env.KUBE_TOKEN;
            });
            it('should return a valid config with CA', () => {
                const c = config.generateAxiosConfig();
                expect(c.baseURL).to.equal('https://env-server:443/apis/networking.istio.io/v1alpha3/namespaces/istio-system');
                expect(c.headers.Authorization).to.equal('Bearer env-token');
                expect(c.httpsAgent.options.ca).to.equal('env-cert');
            });
        });

        describe('without supplied CA', () => {
            before(() => {
                process.env.KUBE_SERVER = 'https://env-server:443';
                process.env.KUBE_TOKEN = 'env-token';
            });
            after(() => {
                delete process.env.KUBE_SERVER;
                delete process.env.KUBE_TOKEN;
            });
            it('should return a valid config disabled TLS server validation', () => {
                const c = config.generateAxiosConfig();
                expect(c.baseURL).to.equal('https://env-server:443/apis/networking.istio.io/v1alpha3/namespaces/istio-system');
                expect(c.headers.Authorization).to.equal('Bearer env-token');
                expect(c.httpsAgent.options.rejectUnauthorized).to.be.false;
            });
        });
    });
});
