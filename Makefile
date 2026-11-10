.DEFAULT_GOAL := help

ifeq ($(OS),Windows_NT)
SHELL := cmd.exe
.SHELLFLAGS := /d /s /c
CD = cd /d "$(HERE)" &&
NULL = nul
INSTALL = powershell -NoProfile -ExecutionPolicy Bypass -File "$(HERE)install.ps1"
else
SHELL := /bin/sh
.SHELLFLAGS := -eu -c
CD = cd "$(HERE)" &&
NULL = /dev/null
INSTALL = sh "$(HERE)install.sh"
endif

NODE ?= node
HERE := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: help test build smoke dist release install uninstall

help:
	@echo gitmuster targets
	@echo   make test       Run local fixture tests (no network)
	@echo   make build      Verify syntax and tests before releasing
	@echo   make dist       Build the release asset the installers download
	@echo   make release    Publish TAG=vX.Y.Z with notes from NOTES=path.md
	@echo   make smoke      Run the CLI against one folder: make smoke FOLDER=repo-name
	@echo   make install    Install a published release for this user
	@echo   make uninstall  Remove the installed command
	@echo.
	@echo After install, run gitmuster in any folder that holds repositories.
	@echo To run the working copy without installing: node cli.mjs help

test:
	@$(CD) $(NODE) --test "*.test.mjs"

build: test
	@$(CD) $(NODE) --check cli.mjs && $(NODE) --check repositories.mjs && $(NODE) --check picker.mjs
	@$(CD) $(NODE) cli.mjs help > $(NULL) && echo BUILD OK

dist:
	@$(CD) sh scripts/build-release.sh dist

# Notes are piped in and removed by the script; the repository never holds a copy.
# Set CHANNEL=beta for a pre-release.
release:
	@$(if $(TAG),,$(error TAG is required, for example: make release TAG=v1.0.0 NOTES=notes.md))
	@$(if $(NOTES),,$(error NOTES is required, for example: make release TAG=v1.0.0 NOTES=notes.md))
	@$(CD) sh scripts/release.sh "$(TAG)" "$(TAG)" $(if $(filter beta,$(CHANNEL)),--prerelease) < "$(NOTES)"

smoke:
	@$(CD) $(NODE) cli.mjs sync $(if $(FOLDER),--folders "$(FOLDER)")

install:
	@$(INSTALL) $(if $(VERSION),-Version "$(VERSION)")

uninstall:
	@$(INSTALL) $(if $(filter Windows_NT,$(OS)),-Uninstall,--uninstall)
