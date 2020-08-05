.PHONY: test build-image push-image all deploy clean check-imagename

all: test check-imagename build-image push-image deploy

src/node_modules: src/package.json
	cd src && npm install

test: src/node_modules
	cd src && npm test

build-image: check-imagename
	cd src && pack build $(image-name) --builder cloudfoundry/cnb:bionic

push-image: check-imagename
	docker push $(image-name)

deploy:
	kubectl apply --namespace=default --filename=deploy

clean:
	rm -rf src/node_modules

check-imagename:
ifndef image-name
	$(error image-name is undefined)
endif
