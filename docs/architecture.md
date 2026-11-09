# Web Shop architecture

This page is kept up to date by `sdv md-sync docs/architecture.md`: everything between the
`sdv:view` markers is regenerated from the design model, everything else is hand-written.

## System context

Customers order through the web shop, which charges cards through the payment provider and
notifies the warehouse.

<!-- sdv:view system-context format=mermaid -->
```mermaid
---
title: "Web Shop — system context"
---
flowchart TD
  customer(["Customer<br/>[Person]"])
  shop["Web Shop<br/>[Software System]"]
  payments["Payment Provider<br/>[External System]"]
  warehouse["Warehouse System<br/>[External System]"]
  customer -->|"Places orders"| shop
  shop -->|"Charges card"| payments
  shop -.->|"Notifies"| warehouse
  classDef external fill:#8a8a8a,stroke:#606060,color:#ffffff
  class payments,warehouse external
  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  class customer person
  classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff
  class shop system
```
<!-- /sdv:view -->

## Containers

<!-- sdv:view shop-containers format=svg -->
![Web Shop — containers](diagrams/shop-containers.svg)
<!-- /sdv:view -->

## Placing an order

<!-- sdv:view place-order format=mermaid -->
```mermaid
---
title: "Place order"
---
sequenceDiagram
  actor customer as Customer
  participant order_service as Order Service
  participant payments as Payment Provider
  participant order_db as Order DB
  customer->>order_service: POST /orders
  order_service->>order_service: validate()
  order_service->>payments: charge()
  activate payments
  payments-->>order_service: ok
  deactivate payments
  alt charge succeeded
    order_service->>order_db: INSERT order
    order_service-->>customer: 201 Created
  else charge failed
    order_service-->>customer: 402
  end
  Note over order_service,order_db: Stored in one transaction
```
<!-- /sdv:view -->

## Checkout flow

<!-- sdv:view checkout-flow format=svg -->
![Checkout](diagrams/checkout-flow.svg)
<!-- /sdv:view -->
