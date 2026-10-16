# The updater: installs a newer signed Cryptovich when an administrator asks
# for it from the site. Docker's own CLI image (with compose), plus what
# the script and scripts/upgrade.sh use.
FROM docker:27-cli
RUN apk add --no-cache bash curl unzip openssl jq coreutils
COPY updater.sh /usr/local/bin/updater.sh
RUN chmod +x /usr/local/bin/updater.sh
CMD ["/usr/local/bin/updater.sh"]
