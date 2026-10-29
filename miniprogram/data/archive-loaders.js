// Literal paths let WeChat detect cross-package async dependencies.
const loaders={
  corpus01: () => require.async('../corpus01/data.js'),
  corpus02: () => require.async('../corpus02/data.js'),
  corpus03: () => require.async('../corpus03/data.js')
};
module.exports={load(name){if(!loaders[name])return Promise.reject(new Error("Unknown archive package"));return loaders[name]();}};
