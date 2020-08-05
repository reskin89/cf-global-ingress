#!/usr/bin/env node

const NATS = require('nats')
const axios = require('axios');
const config = require('./config');
const SequentialTaskQueue = require('sequential-task-queue').SequentialTaskQueue;
const tld = ".cluster.local";
const filterDomain = 'localhost';

const nats_user = process.env.NATS_USER || 'nats_user';
const nats_password = process.env.NATS_PASSWORD;
const nats_servers = process.env.NATS_SERVERS.split(',');
const cfSite = process.env.CF_SITE || 'undefined';
const cfLocality = "us/z1/" + cfSite;

const nc = NATS.connect({
    json: true,
    servers: nats_servers,
    user: nats_user,
    pass: nats_password
});

const istioHttpClient = axios.create(config.generateAxiosConfig());

// currentServer is the URL of the connected server.
nc.on('connect', () => {
  console.log('Connected to ' + nc.currentServer.url.host);
})

nc.on('subscribe', function (sid, subject) {
  console.log('subscribed to', sid, 'for subject', subject)
})

nc.subscribe('router.register', {queue: "register"}, registerRouteHandler)
nc.subscribe('router.unregister', {queue: "unregister"}, unregisterRouteHandler)

var queue = new SequentialTaskQueue();

function registerRouteHandler(msg) {
    if (msg.tags != null && msg.tags.component != null && msg.tags.component == "route-emitter" && msg.uris[0].endsWith(filterDomain)) {
        console.log("Register -------:", msg)
        queue.push(() => addOrUpdateServiceEntry(msg));
        // addOrUpdateVirtualService(msg)
    }
}

var deregistry = {};

function unregisterRouteHandler(msg) {
    if (deregistry[msg.private_instance_id]) {
        console.log("Already Unregistered -------:", msg);
    } else {
        deregistry[msg.private_instance_id] = true;
        console.log("Unregister -------:", msg);
        queue.push(() => deleteOrUpdateServiceEntry(msg));
    }
}

function deleteOrUpdateServiceEntry(msg) {
    return new Promise((resolve, reject) => {
        istioHttpClient.get("/serviceentries/" + getSEName(msg), { validateStatus: function (status) { return (status == 404 || status == 200); } })
        .then( function(response) {
            if (response.status == 404) {
                console.log("ServiceEntry " + getSEName(msg) + " does not exist. NOOP")
                resolve();
            } else if (response.status == 200) {
                console.log("ServiceEntry " + getSEName(msg) + " already exists. Trying to delete endpoint.")
                deleteEndpoint(response.data, msg)
                .then(() => resolve())
                .catch(() => reject())
            }
        })
        .catch( function(error) {
            console.error("Unknown error querying Service Entry at /serviceentries/" + getSEName(msg) + ". Response was: " + error.response)
            reject();
        });
    });
}

// Service Entry ops

// Service Entry name from message
function getSEName(msg) {
    // return msg.uris[0] + "-" + msg.app + "-" + msg.private_instance_index
    // return msg.uris[0] + "-" + msg.app
    // return msg.host + "-" + msg.port
    // return msg.uris[0]
    return msg.app
}

function addOrUpdateServiceEntry(msg) {
    return new Promise((resolve, reject) => {
        istioHttpClient.get("/serviceentries/" + getSEName(msg), { validateStatus: function (status) { return (status == 404 || status == 200); } })
        .then( function(response) {
            if (response.status == 404) {
                console.log("ServiceEntry " + getSEName(msg) + " does not exist. Creating a new one.")
                addServiceEntry(msg)
                .then(resolve())
                .catch(reject());
            } else if (response.status == 200) {
                console.log("ServiceEntry " + getSEName(msg) + " already exists. Trying to update.")
                addEndpoint(response.data, msg)
                .then(() => resolve())
                .catch(() => reject());
            }
        })
        .catch( function(error) {
            console.error("Unknown error querying Service Entry at /serviceentries/" + getSEName(msg) + ". Response was: " + error.response);
            reject();
        });
    });
}

function addServiceEntry(msg) {
    return new Promise((resolve, reject) => {
        istioHttpClient.post("/serviceentries/", buildServiceEntry(msg))
        .then(function (response) {
            console.log("Created new Service Entry: " + getSEName(msg));
            resolve();
        })
        .catch(function (error) {
            console.log(error)
            console.error("Error creating Service Entry: " + error.response.data);
            reject();
         }
    );
    });
}

function buildServiceEntry(msg) {
    let hostName = msg.app + tld;
    let serviceEntry = {
        apiVersion: "networking.istio.io/v1alpha3",
        kind: "ServiceEntry",
        metadata: {
            name: getSEName(msg),
            labels: {
                origin: "feeder",
                'cf-site': cfSite
            }
        },

        spec: {
            hosts: [hostName],
            resolution: "STATIC",
            location: "MESH_INTERNAL",
            ports: [
                {
                    number: msg.port,
                    name: "http",
                    protocol: "HTTP"
                }
            ],
            endpoints: [
                {
                    address: msg.host,
                    ports: {
                        http: msg.port
                    }
                    ,
                    labels: {
                        'cf-app-guid': msg.app,
                        'cf-instance-guid': msg.private_instance_id,
                        'cf-instance-idx': msg.private_instance_index
                    },
                    locality: cfLocality
                }
            ]
        }
    }
    return serviceEntry
}


function addEndpoint(serviceEntry, msg) {
    return new Promise((resolve, reject) => {
        endPointExists = serviceEntry.spec.endpoints.some(ep => (ep.address === msg.host && ep.ports.http === msg.port));
        if (!(endPointExists)) {
            // updating the SE port, because otherwise it gets broken. Probably a bug in Istio.
            serviceEntry.spec.ports[0].number++;

            serviceEntry.spec.endpoints.push(
                {
                    address: msg.host,
                    ports: {
                        http: msg.port
                    }
                    ,
                    labels: {
                        'cf-app-guid': msg.app,
                        'cf-instance-guid': msg.private_instance_id,
                        'cf-instance-idx': msg.private_instance_index
                    },
                    locality: cfLocality
                });

            istioHttpClient.put("/serviceentries/" + serviceEntry.metadata.name, serviceEntry)
                .then(function (response) {
                    console.log(response);
                    resolve();
                })
                .catch(function (error) {
                    console.log(error);
                    reject();
                }
            );
        } else {
            resolve();
        }
    });
}


// VirtualService ops

// function getVSName(msg) {
//     return msg.uris[0];
// }

// function addOrUpdateVirtualService(msg) {
//     istioHttpClient.get("/virtualservices/" + getVSName(msg), { validateStatus: function (status) { return status == 404; } })
//         .then( function(response) {
//             console.log("VirtualService " + getVSName(msg) + " does not exist, create new.");
//             addVirtualService(msg);
//         })
//         .catch( function(error) {
//             if (error.response.status == 200) {
//                 console.log("VirtualService " + getVSName(msg) + " already exists. NOOP, Skipping.");
//             } else {
//                 console.error("Unknown error querying Virtual Service  at /virtualservices/" + getVSName(msg) + ". Response was: " + error.response);
//             }
//         });
// }

// function addVirtualService(msg) {
//     istioHttpClient.post("/virtualservices/", buildVirtualServiceFromNatsMsg(msg))
//         .then(function (response) {
//             console.log("Created new Virtual Service: " + getVSName(msg));
//         })
//         .catch(function (error) {
//             console.error("Error creating Virtual Service: " + error);
//          }
//     );
// }

// function buildVirtualServiceFromNatsMsg(msg) {
//     let hostName = msg.app + tld
//     let virtualService = {
//         apiVersion: "networking.istio.io/v1alpha3",
//         kind: "VirtualService",
//         metadata: {
//             name: getVSName(msg),
//             labels: {
//                 origin: "feeder",
//                 'cf-site': cfSite
//             }
//         },
//         spec: {
//             hosts: [msg.uris[0]],
//             gateways: ["cf-gateway"],
//             http: [
//                 {
//                     route: [
//                         {
//                             destination: {
//                                 host: hostName
//                             }
//                         }
//                     ]
//                 }
//             ]
//         }
//     }
//     return virtualService
// }

function deleteEndpoint (serviceEntry, msg) {
    return new Promise((resolve, reject) => {
        index = serviceEntry.spec.endpoints.findIndex(ep => (ep.address === msg.host && ep.ports.http === msg.port));
        console.log("Total Endpoints before delete: " + serviceEntry.spec.endpoints.length)
        if (index >= 0) {

            console.log("Found Endpoint in ServiceEntry");

            if (serviceEntry.spec.endpoints.length == 1) {
                console.log("Deleting Service Entry");
                istioHttpClient.delete("/serviceentries/" + serviceEntry.metadata.name)
                    .then(function (response) {
                        console.log(response);
                        resolve();
                    })
                    .catch(function (error) {
                        console.log(error);
                        reject();
                    }
                );
            } else {
                serviceEntry.spec.endpoints.splice(index, 1);
                serviceEntry.spec.ports[0].number--;

                istioHttpClient.put("/serviceentries/" + serviceEntry.metadata.name, serviceEntry)
                    .then(function (response) {
                        console.log(response);
                        resolve();
                    })
                    .catch(function (error) {
                        console.log(error);
                        reject();
                    }
                );
            }
        } else {
            resolve();
        }
    });
}
