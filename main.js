$(document).ready(() => {
    let portal = null;
    let credential = null;
    let userQuery = "";
    let items = null;
    let progress = 0;
    let total = 0;
    const processes = 2;
    $.getJSON("config.json", function (config) {
        require([
            "esri/portal/Portal",
            "esri/identity/OAuthInfo",
            "esri/identity/IdentityManager",
        ], function (Portal, OAuthInfo, esriId) {
            const info = new OAuthInfo({
                appId: config.appId,
                popup: false,
                portalUrl: config.portalUrl,
            });
            esriId.registerOAuthInfos([info]);

            esriId
                .checkSignInStatus(info.portalUrl + "/sharing")
                .then(() => {
                    handleSignedIn();
                })

                .catch(() => {
                    handleSignedOut();
                });

            esriId.getCredential(info.portalUrl + "/sharing").then((result) => {
                credential = result;
            });

            $("#searchForm").submit(handleSearch);

            function displayLoading(isLoading) {
                document.querySelector("#pageLoader").hidden = true;
                progress = 0;
                document.querySelector("calcite-shell").hidden = isLoading;
                document.querySelector("#progressBar").hidden = !isLoading;
            }

            function handleSignedIn() {
                portal = new Portal();
                portal.load().then(() => {
                    document.querySelector("#pageLoader").hidden = false;
                    document.querySelector("#userArea").innerHTML = `
                    <calcite-chip value="${portal.user.fullName}" appearance="outline-fill">
                        <calcite-avatar slot="image" full-name="${portal.user.fullName}"></calcite-avatar>
                        ${portal.user.fullName}
                    </calcite-chip>
                `;
                    displayLoading(false);
                });
            }

            function handleSignedOut() {
                displayLoading(true);
            }

            function handleSearch(evt) {
                evt.preventDefault();
                userQuery = evt.target.elements.query.value;
                if (userQuery.length > 0) {
                    displayLoading(true);
                    getItems();
                }
            }

            function getItems(start = 1) {
                const query = {
                    query: `orgid:${portal.id}`,
                    filter: `type:"Feature Service" AND orgItem:true`,
                    sortField: "title",
                    sortOrder: "asc",
                    num: 100,
                    start: start,
                };
                portal.queryItems(query).then((response) => {
                    if (start == 1) {
                        items = response.results;
                    } else {
                        items = items.concat(response.results);
                    }
                    if (response.nextQueryParams.start != -1) {
                        getItems(response.nextQueryParams.start);
                    } else {
                        total = items.length * processes;
                        getLayerInfos();
                    }
                });
            }

            function getLayerInfos() {
                Promise.all(
                    items.map((item) =>
                        fetch(
                            `${item.url}/layers?f=json&token=${credential.token}`
                        ).then(updateProgressBar)
                    )
                )
                    .then((responses) =>
                        Promise.all(responses.map((res) => res.json()))
                    )
                    .then((results) => {
                        results.forEach((result, resultIndex) => {
                            items[resultIndex].layers = [];
                            if (!result.error) {
                                result.layers.forEach((resultLayer) => {
                                    items[resultIndex].layers[resultLayer.id] =
                                        resultLayer;
                                });
                                result.tables?.forEach((resultTable) => {
                                    items[resultIndex].layers[resultTable.id] =
                                        resultTable;
                                });
                            }
                        });
                        queryItems();
                    });
            }

            function queryItems() {
                Promise.all(
                    items.map((item) => {
                        const serviceQuery = [];
                        item.layers.forEach((layer) => {
                            if (layer.capabilities.includes("Query")) {
                                serviceQuery.push({
                                    layerId: layer.id,
                                    where: getWhereClause(layer),
                                });
                            }
                        });
                        return fetch(
                            `${item.url}/query?f=json&token=${credential.token}`,
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type":
                                        "application/x-www-form-urlencoded",
                                },
                                body: `layerDefs=${JSON.stringify(
                                    serviceQuery
                                )}&returnCountOnly=true`,
                            }
                        ).then(updateProgressBar);
                    })
                )
                    .then((responses) =>
                        Promise.all(responses.map((res) => res.json()))
                    )
                    .then((results) => {
                        results.forEach((result, resultIndex) => {
                            if (!result.error) {
                                result.layers.forEach((layer) => {
                                    items[resultIndex].layers[
                                        layer.id
                                    ].resultCount = layer.count;
                                });
                            }
                        });
                        filterResults();
                    });
            }

            function filterResults() {
                items = items.filter((item) => {
                    item.matchReasons = [];
                    if (
                        item.title &&
                        item.title
                            .toUpperCase()
                            .includes(userQuery.toUpperCase())
                    ) {
                        item.matchReasons.push("Title");
                    }
                    if (
                        item.description &&
                        item.description
                            .toUpperCase()
                            .includes(userQuery.toUpperCase())
                    ) {
                        item.matchReasons.push("Description");
                    }
                    if (
                        item.snippet &&
                        item.snippet
                            .toUpperCase()
                            .includes(userQuery.toUpperCase())
                    ) {
                        item.matchReasons.push("Snippet");
                    }
                    if (
                        item.tags &&
                        item.tags.filter((tag) =>
                            tag.toUpperCase().includes(userQuery.toUpperCase())
                        ).length > 0
                    ) {
                        item.matchReasons.push("tags");
                    }
                    item.layers.forEach((layer) => {
                        if (layer.resultCount > 0) {
                            item.matchReasons.push(
                                `layer:${layer.id}:${layer.resultCount}`
                            );
                        }
                    });
                    return item.matchReasons.length > 0;
                });
                displayResults();
            }

            function displayResults() {
                items = items.map((item) => {
                    return `
                    <calcite-card ${
                        item.thumbnailUrl
                            ? `thumbnail-position="inline-start"`
                            : ""
                    } class="card">
                        <span slot="heading"><h2>${item.title}</h2></span>
                        <span slot="description">
                            ${
                                item.snippet
                                    ? `<p style="font-size:smaller; margin:0;">${item.snippet}</p>`
                                    : ""
                            }
                            ${
                                item.description
                                    ? `<p>${item.description}</p>`
                                    : ""
                            }
                        </span>
                        <div slot="footer-start">
                            ${item.matchReasons.map((reason) => {
                                if (reason.includes("layer")) {
                                    const [_, layerId, count] =
                                        reason.split(":");
                                    return `<calcite-chip scale="s" appearance="clear">${
                                        item.layers[layerId].name
                                    } (${layerId}): ${count} feature${
                                        count > 1 ? "s" : ""
                                    }</calcite-chip>`;
                                } else {
                                    return `<calcite-chip scale="s" appearance="clear">${reason}</calcite-chip>`;
                                }
                            })}
                        </div>
                        <div slot="footer-end">
                            <calcite-button
                                href="${config.portalUrl}/home/item.html?id=${
                        item.id
                    }"
                                appearance="solid"
                                scale="l" 
                                icon="view-visible"
                                target="_blank"
                            >
                                View
                            </calcite-button>
                        </div>
                        ${
                            item.thumbnailUrl
                                ? `<img slot="thumbnail" alt="Sample image alt" src="${item.thumbnailUrl}">`
                                : ""
                        }
                    </calcite-card>
                    `;
                });
                document.querySelector("#searchResults").innerHTML =
                    items.join("");
                displayLoading(false);
            }

            function getWhereClause(layer) {
                const upperQuery = userQuery.toUpperCase();
                let where = [];
                layer.fields.forEach((field) => {
                    if (field.type == "esriFieldTypeString") {
                        where.push(
                            `UPPER(${field.name}) LIKE '%${upperQuery}%'`
                        );
                    } else if (
                        (field.type == "esriFieldTypeInteger" ||
                            field.type == "esriFieldTypeDouble") &&
                        !isNaN(userQuery)
                    ) {
                        where.push(`${field.name} = ${userQuery}`);
                    }
                });
                if (where.length > 0) {
                    return where.join(" OR ");
                } else {
                    return "1=0";
                }
            }

            function updateProgressBar(items) {
                progress++;
                document.querySelector("#progressBar").value = Math.floor(
                    (progress / total) * 100
                );
                return items;
            }
        });
    });
});
