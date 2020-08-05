const fs = require('fs');
const https = require('https');

function generateAxiosConfig() {
    return {
        baseURL: `${getK8sServer()}/apis/networking.istio.io/v1alpha3/namespaces/istio-system`,
        headers: {
            'Authorization': `Bearer ${getK8sToken()}`,
            'Content-Type': 'application/json'
        },
        httpsAgent: new https.Agent((getK8sCA()) ? {ca: getK8sCA()} : {rejectUnauthorized: false})
    }
}

function getK8sToken() {
    if (process.env.KUBE_TOKEN) {
        return process.env.KUBE_TOKEN;
    } else {
        try {
            return fs.readFileSync('/run/secrets/kubernetes.io/serviceaccount/token', 'ascii');
        } catch (err) {
            return undefined;
        }
    }
}

function getK8sServer() {
    if (process.env.KUBE_SERVER) {
        return process.env.KUBE_SERVER;
    } else if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
            return `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`
    } else {
        return undefined;
    }
}

function getK8sCA() {
    if (process.env.KUBE_CA) {
        return process.env.KUBE_CA;
    } else {
        try {
            return fs.readFileSync('/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'ascii');
        } catch (err) {
            return undefined;
        }
    }
}

function getK8sNamespace() {
    if (process.env.KUBE_NAMESPACE) {
        return process.env.KUBE_NAMESPACE;
    } else {
        try {
            return fs.readFileSync('/run/secrets/kubernetes.io/serviceaccount/namespace', 'ascii');
        } catch (err) {
            return 'default';
        }
    }
}

module.exports = {
    getK8sToken: getK8sToken,
    getK8sServer: getK8sServer,
    getK8sCA: getK8sCA,
    getK8sNamespace: getK8sNamespace,
    generateAxiosConfig: generateAxiosConfig
}
