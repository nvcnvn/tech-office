FROM postgres:18-bookworm

ARG PG_TEXTSEARCH_VERSION=v1.0.0
ARG CITUS_VERSION=v14.0.0

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		git \
		build-essential \
		clang \
		llvm-dev \
		libicu-dev \
		libcurl4-openssl-dev \
		libssl-dev \
		libkrb5-dev \
		flex \
		bison \
		pkg-config \
		liblz4-dev \
		libzstd-dev \
		autoconf \
		automake \
		libtool \
		postgresql-server-dev-18 \
		ca-certificates \
		pgbackrest \
		curl \
		gnupg \
		lsb-release \
		unzip \
		wget \
	&& wget -q "https://packages.groonga.org/debian/groonga-apt-source-latest-$(lsb_release --codename --short).deb" \
	&& apt-get install -y --no-install-recommends "./groonga-apt-source-latest-$(lsb_release --codename --short).deb" \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends postgresql-18-pgdg-pgroonga groonga-tokenizer-mecab \
	&& arch="$(dpkg --print-architecture)" \
	&& curl -fsSL -o /tmp/pg-textsearch.zip "https://github.com/timescale/pg_textsearch/releases/download/${PG_TEXTSEARCH_VERSION}/pg-textsearch-${PG_TEXTSEARCH_VERSION}-pg18-${arch}.zip" \
	&& unzip -q /tmp/pg-textsearch.zip -d /tmp/pg-textsearch \
	&& apt-get install -y --no-install-recommends /tmp/pg-textsearch/*.deb \
	&& git clone --depth 1 --branch "${CITUS_VERSION}" https://github.com/citusdata/citus.git /tmp/citus \
	&& cd /tmp/citus \
	&& ./configure \
	&& make -j"$(nproc)" \
	&& make install \
	&& cd / \
	&& rm -rf /tmp/citus \
	&& rm -rf /var/lib/apt/lists/* /tmp/pg-textsearch /tmp/pg-textsearch.zip \
	&& rm -f "./groonga-apt-source-latest-$(lsb_release --codename --short).deb"