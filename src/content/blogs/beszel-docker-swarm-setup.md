---
title: "Monitor Containers on Docker Swarm using Beszel"
date: "November 21, 2026"
time: "09:30"
excerpt: "This document describes the current Beszel setup for monitoring Docker Swarm nodes and containers."
category: "Devops"
tools:
  - name: Beszel
    icon: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/beszel-light.svg"
  - name: Docker
    icon: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/docker-light.svg"
  - name: Portainer (Optional)
    icon: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/portainer-light.svg"
---

## Table of contents

- [Architecture](#architecture)
- [1. Create the overlay network](#1-create-the-overlay-network)
- [2. Beszel Hub setup](#2-beszel-hub-setup)
  - [2.1 Initialize manager node](#21-initialize-manager-node)
  - [2.2 Deploy the Beszel Hub](#22-deploy-the-beszel-hub)
  - [2.3 Open the Hub and create the admin account](#23-open-the-hub-and-create-the-admin-account)
- [3 Beszel agent setup](#3-beszel-agent-setup)
  - [3.1 Find public key and universal token from beszel hub settings](#31-find-public-key-and-universal-token-from-beszel-hub-settings)
  - [3.2 Create Docker Swarm secrets](#32-create-docker-swarm-secrets)
  - [3.3 Deploy the Beszel Agent Global service](#33-deploy-the-beszel-agent-global-service)
  - [3.4 What Global mode does](#what-global-mode-does)
- [4. Restrict dashboard access to Manager nodes](#4-restrict-dashboard-access-to-manager-nodes)
- [5. Adding a new Swarm node](#5-adding-a-new-swarm-node)
- [6. Useful verification commands](#6-useful-verification-commands)
- [7. Operational notes](#6-operational-notes)

## Architecture

-   One **Beszel Hub** runs as a single service on the _designated_
    Manager node.
-   The **Beszel Agent** runs as a Global Swarm service, with one Agent
    on every eligible Manager and Worker node.
-   Agents connect to the Hub through the `beszel-hub` overlay network.
-   The Hub dashboard is published on TCP port `8090`.
-   Each Agent has read-only access to the local Docker socket to
    collect container metrics.

![Beszel Docker Swarm Network Diagram](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-swarm-network-diagram-dark-compressed.png)

## 1. Create the overlay network

The overlay network lets the Hub and Agents communicate across Swarm nodes.
It also keeps Beszel traffic isolated from unrelated container networks.

Run once from a Swarm Manager:

``` bash
docker network create \
  --driver overlay \
  --attachable \
  beszel-hub
```
If `beszel-hub` already exists, use the existing network.

## 2. Beszel Hub setup

### 2.1 Initialize manager node

First, decide which Manager node in your Docker Swarm cluster will host the Beszel Hub.

Run the following command from any Manager node to label your selected Manager:

```bash
docker node update --label-add beszel-hub=true MANAGER_NODE_NAME
```

Replace `MANAGER_NODE_NAME` with the actual Swarm node name.

> **Why are we doing this?**
>
> Docker Swarm can schedule a service with `replicas: 1` on any eligible node in the cluster. Without a placement constraint, the Beszel Hub could run on a different Manager or Worker node than intended.
>
> By applying this label, we can use it as a placement constraint in our stack, ensuring that Docker Swarm schedules the Beszel Hub only on the designated Manager node.

Next, SSH into the Manager node you just labelled and create the Hub data directory:

```bash
sudo mkdir -p /opt/beszel/data
```

This directory will store the Hub's persistent data, allowing it to survive container restarts and service redeployments.

### 2.2 Deploy the Beszel Hub

Create a service or stack in Portainer using:

To create a service in the Portainer dashboard, go to **Services** > **Create service**, enter the settings below, and submit.

-   Image: `henrygd/beszel:0.21.2`
-   Replicas: `1`
-   Container port: `8090`
-   Published port: `8090`
-   Publish mode: `Ingress`
-   Bind mount: `/opt/beszel/data` → `/beszel_data`
-   Network: `beszel-hub`
-   Placement constraint: `node.labels.beszel-hub == true`

To deploy it as a stack, go to **Stacks** > **Add stack** in the Portainer dashboard. Enter a name, add the YAML configuration in the web editor, and submit.

Example stack:

``` yaml
services:
  beszel-hub:
    image: henrygd/beszel:0.21.2
    ports:
      - target: 8090
        published: 8090
        protocol: tcp
        mode: ingress
    volumes:
      - /opt/beszel/data:/beszel_data
    networks:
      - beszel-hub
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.labels.beszel-hub == true

networks:
  beszel-hub:
    external: true
    name: beszel-hub
```

The bind mount source directory must exist on the node where the Hub is
scheduled.

### 2.3 Open the Hub and create the admin account

After the Hub service is running, open the dashboard in a browser:

``` text
http://MANAGER_IP:8090
```

On the first visit:

1.  Create the Beszel admin account using the sign-up screen & log in. 

![Beszel Login](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-login.png)

2.  Open the Hub dashboard in the UI. The node list will be empty because we have only created the Hub and have not added any nodes to monitor yet.

![Beszel Login](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-dashboard-blank.png)

## 3 Beszel agent setup

To monitor your Swarm nodes, deploy the Beszel Agent as a global service. Docker Swarm runs one Agent task on each eligible node and automatically starts an Agent on eligible nodes that join the cluster later. This means you do not need to deploy an Agent separately on every node.

Each Agent connects to the Hub over the `beszel-hub` overlay network and uses the Hub's Public Key and Universal Token to register. We will store these credentials as Docker Swarm secrets and reference them in the Agent stack.

To set this up, first obtain the credentials from the Hub, then create the secrets and deploy the Agent stack.

### 3.1 Find public key and universal token from beszel hub settings.

Follow the UI instructions to obtain the Hub **Public Key** and the **Universal Token** needed for Agent registration. Go to **Settings** > **Token & Fingerprints** and copy the secrets. 

![Beszel Token & Fingerprints](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-universal-token-public-key.png)

Keep the Public Key and Universal Token available for the next step. Do
not put their actual values in this document or commit them to source
control.

### 3.2 Create Docker Swarm secrets

Create the two secrets using the values obtained from the Hub UI:

``` bash
printf '%s' 'YOUR_BESZEL_PUBLIC_KEY' | docker secret create beszel-hub-key-1 -
printf '%s' 'YOUR_BESZEL_UNIVERSAL_TOKEN' | docker secret create beszel-hub-token-1 -
```

Secret mapping:

| Docker Secret        | Value from Beszel UI | Purpose                                 |
|:---------------------|:---------------------|:----------------------------------------|
| `beszel-hub-key-1`   | Hub Public Key       | Identifies the Hub to Agents            |
| `beszel-hub-token-1` | Universal Token      | Allows Agents to register with the Hub |


Replace both placeholders with the actual values. These commands create
Swarm secrets; the values themselves are not stored in the stack YAML.

### 3.3 Deploy the Beszel Agent Global service

In Portainer, create a stack with the following configuration:

``` yaml
services:
  beszel-agent:
    image: henrygd/beszel-agent:0.21.2
    deploy:
      mode: global
    environment:
      SYSTEM_NAME: "{{.Node.Hostname}}"
      BESZEL_AGENT_HUB_URL: http://beszel-hub:8090
      BESZEL_AGENT_KEY_FILE: /run/secrets/hub-key
      BESZEL_AGENT_TOKEN_FILE: /run/secrets/hub-token
      BESZEL_AGENT_DISABLE_SSH: "true"
    networks:
      - beszel-hub
    secrets:
      - hub-key
      - hub-token
    volumes:
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
        read_only: true

networks:
  beszel-hub:
    external: true
    name: beszel-hub

secrets:
  hub-key:
    name: beszel-hub-key-1
    external: true
  hub-token:
    name: beszel-hub-token-1
    external: true
```

The secret names in this stack must match the Swarm secret names created
in Step 2.1.

### What Global mode does

-   Runs one Agent on every eligible Manager and Worker node.
-   Automatically schedules an Agent when a new node joins the Swarm.
-   Maintains one Agent task per eligible node.
-   Connects each Agent to the Hub through the `beszel-hub` overlay
    network.

Once you run the stack and create the service, you'll see the node in the dashboard. It is the Hub node because the Hub node is also an Agent node.

![Beszel Login](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-dashboard.png)

Clicking a node opens its dedicated page, where you can view metrics such as RAM, CPU, and disk usage, along with the containers running on that node and their individual metrics.

![Beszel Node Metrics](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-node-metrics.png)
![Beszel Node containers](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-node-containers.png)


## 4. Restrict dashboard access to Manager nodes

The Hub uses Swarm `Ingress` publishing on port `8090`. Swarm's routing
mesh can accept connections on any node IP and forward them to the Hub
task.

To make the dashboard externally reachable only through Manager nodes,
configure the VPS/provider firewall:

-   Allow inbound TCP `8090` on the Manager node(s) where dashboard
    access is intended.
-   Block inbound TCP `8090` on Worker nodes.
-   Where possible, allow only trusted administrator source IP
    addresses.

The Hub placement constraint determines where the Hub runs. Firewall
rules determine which node addresses can be reached from outside the
cluster.

## 5. Adding a new Swarm node

When a new node joins the Swarm:

1.  The Global Agent service schedules an Agent on the new node.
2.  The Agent connects to `http://beszel-hub:8090` over the overlay
    network.
3.  The Agent uses the Public Key and Universal Token supplied through
    the Swarm secrets.
4.  The new node and its container metrics become available in the
    Beszel dashboard.

![Beszel all containers](https://pub-863190a82084455b973ae8e7853383fb.r2.dev/beszel-all-containers.png)

No separate Agent stack deployment is needed for each new node.

## 6. Useful verification commands

List Swarm services:

``` bash
docker service ls
```

Check the Hub task and logs:

``` bash
docker service ps beszel-hub
docker service logs -f beszel-hub
```

Check the Agent tasks:

``` bash
docker service ls
docker service ps <AGENT_STACK_NAME>_beszel-agent
```

Check the Hub Manager label:

``` bash
docker node inspect MANAGER_NODE_NAME \
  --format '{{json .Spec.Labels}}'
```

Inspect the overlay network:

``` bash
docker network inspect beszel-hub
```

## 7. Operational notes

-   Keep `/opt/beszel/data` persistent.
-   Keep the Hub at one replica with this node-local bind-mount
    arrangement.
-   Keep the `beszel-hub=true` label on the intended Hub Manager only.
-   Keep the Agent service in `global` mode.
-   Store the Hub Public Key and Universal Token as Docker secrets.
-   Ensure the `beszel-hub` overlay network is available to both Hub and
    Agent services.
-   If the designated Hub Manager is unavailable, the Hub will not
    automatically move to another Manager with its data unless you also
    arrange suitable shared/replicated storage and update the placement
    strategy.
-   With `Ingress` publishing, use firewall rules on all nodes to
    restrict external access to port `8090`.
