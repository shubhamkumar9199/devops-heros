# Kubernetes volumes

See the [assignment README](../readme.md) for the storage comparison, commands and screenshots. YAML examples are in [volumes](../volumes/) and [mini-project](../mini-project/).

`emptyDir` is tied to the Pod lifetime; `hostPath` is tied to a node path. PersistentVolumes expose storage capacity and access policies; PersistentVolumeClaims request it. A StorageClass selects a provisioner so matching PVCs can dynamically create PVs. In the actual Minikube run, the 500 MiB claim became Bound, and both emptyDir and hostPath files were written and read successfully.
