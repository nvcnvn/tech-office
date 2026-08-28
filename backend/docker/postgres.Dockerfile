FROM postgres:18-bookworm

ARG PG_TEXTSEARCH_VERSION=v1.0.0

ENV DEBIAN_FRONTEND=noninteractive

# Every extension here ships as a .deb or a prebuilt zip, so the image needs no
# compiler toolchain. Keep it that way: a source build would drag build-essential,
# llvm and postgresql-server-dev back into the runtime image.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		pgbackrest \
		curl \
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
	&& rm -rf /var/lib/apt/lists/* /tmp/pg-textsearch /tmp/pg-textsearch.zip \
	&& rm -f "./groonga-apt-source-latest-$(lsb_release --codename --short).deb"
