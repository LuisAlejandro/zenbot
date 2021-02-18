#!/bin/bash

for f in extensions/exchanges/*/update-products.sh;
do
  ./${f} || true
done
