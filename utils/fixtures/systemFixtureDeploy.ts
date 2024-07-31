import { ethers, providers, Contract } from "ethers";
import { ContractTransaction, Signer } from "ethers";
import { BigNumber } from "ethers";
import hre from "hardhat";

import {
  BasicIssuanceModule,
  Controller,
  IntegrationRegistry,
  PriceOracle,
  SetToken,
  SetTokenCreator,
  SetValuer,
  CustomOracleNavIssuanceModule,
} from "../contracts";
import DeployHelper from "../deploys";
import {
  ether,
  ProtocolUtils,
} from "../common";
import {
  Address,
} from "../types";

import { SetToken__factory } from "../../typechain/factories/SetToken__factory";
import { MAX_UINT_256 } from "@utils/constants";
// Import TypeChain-generated factories
import { ERC20__factory } from "@typechain/index";
import { ERC20 } from "@typechain/index";


export class SystemFixtureDeploy {
  private _provider: providers.Web3Provider | providers.JsonRpcProvider;
  private _ownerAddress: Address;
  private _ownerSigner: Signer;
  private _deployer: DeployHelper;

  public controller: Controller;
  public factory: SetTokenCreator;
  public priceOracle: PriceOracle;
  public integrationRegistry: IntegrationRegistry;
  public setValuer: SetValuer;

  public issuanceModule: BasicIssuanceModule;
  public navIssuanceModule: CustomOracleNavIssuanceModule;
  public uniswapFactoryAddress: Address;
  public uniswapRouterAddress: Address;
  public uniswapNonFungiblePositionManagerAddress: Address;

  public uni: ERC20;
  public aave: ERC20;
  public weth: ERC20;

  public components: ERC20[] = [];

  public poolAddresses: Address[] = [];
  public uniswapPriceAdapter: Contract;

  constructor(provider: providers.Web3Provider | providers.JsonRpcProvider, ownerAddress: Address) {
    this._provider = provider;
    this._ownerAddress = ownerAddress;
    this._ownerSigner = provider.getSigner(ownerAddress);
    this._deployer = new DeployHelper(this._ownerSigner);
  }

  public async initialize(): Promise<void> {

    console.log("SystemFixtureDeploy initializing");

    this.controller = await this._deployer.core.deployController(this._ownerAddress);

    this.issuanceModule = await this._deployer.modules.deployBasicIssuanceModule(this.controller.address);

    await this.initializeStandardComponents();

    this.factory = await this._deployer.core.deploySetTokenCreator(this.controller.address);

    console.log("Deploying UniswapPriceAdapter...");

    const UniswapV3PriceAdapterFactory = await hre.ethers.getContractFactory("UniswapV3PairPriceAdapter");
    this.uniswapPriceAdapter = await UniswapV3PriceAdapterFactory.deploy(this.poolAddresses);
    await this.uniswapPriceAdapter.deployed();

    console.log("Deploying PriceOracle...");

    this.priceOracle = await this._deployer.core.deployPriceOracle(
      this.controller.address,
      this.weth.address,
      [this.uniswapPriceAdapter.address],
      [],
      [],
      [],
    );

    this.integrationRegistry = await this._deployer.core.deployIntegrationRegistry(this.controller.address);

    this.setValuer = await this._deployer.core.deploySetValuer(this.controller.address);
    this.navIssuanceModule = await this._deployer.modules.deployCustomOracleNavIssuanceModule(this.controller.address, this.weth.address);
    await this.weth.approve(this.navIssuanceModule.address, MAX_UINT_256);

    await this.controller.initialize(
      [this.factory.address], // Factories
      [this.issuanceModule.address, this.navIssuanceModule.address], // Modules
      [this.integrationRegistry.address, this.priceOracle.address, this.setValuer.address], // Resources
      [0, 1, 2]  // Resource IDs where IntegrationRegistry is 0, PriceOracle is 1, SetValuer is 2
    );

    console.log("SystemFixtureDeploy initialized");
  }

  public async initializeStandardComponents(): Promise<void> {

    const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
    this.weth = ERC20__factory.connect(wethAddress, this._ownerSigner);
    await this.weth.approve(this.issuanceModule.address, ether(10000));

    const componentData = [
      ["0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0", 3000],
      ["0x9623063377ad1b27544c965ccd7342f7ea7e88c7", 3000],
      ["0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60", 3000],
      ["0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8", 3000],
      ["0x912ce59144191c1204e64559fe8253a0e49e6548", 500],
      ["0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a", 10000],
      ["0x371c7ec6d8039ff7933a2aa28eb827ffe1f52f07", 10000],
      ["0x18c11fd286c5ec11c3b683caa813b77f5163a122", 3000],
      ["0x3082cc23568ea640225c2467653db90e9250aaa0", 3000],
      ["0x4e352cf164e64adcbad318c3a1e222e9eba4ce42", 10000],
      ["0x7dd747d63b094971e6638313a6a2685e80c7fb2e", 3000],
      ["0x0341c0c0ec423328621788d4854119b97f44e391", 10000],
      ["0x58b9cb810a68a7f3e1e4f8cb45d1b9b3c79705e8", 10000],
      ["0xf1264873436a0771e440e2b28072fafcc5eebd01", 100],
    ];

    this.components = componentData.map(data => ERC20__factory.connect(data[0].toString(), this._ownerSigner));

    this.uniswapFactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    this.uniswapRouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
    this.uniswapNonFungiblePositionManagerAddress = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

    const factoryContract = new ethers.Contract(
      this.uniswapFactoryAddress,
      [
        "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
        "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)"
      ],
      this._ownerSigner
    );

    for (let i = 0; i < 10; i++) {
      await this.components[i].approve(this.issuanceModule.address, ether(10000));
      const poolAddress = await factoryContract.getPool(componentData[i][0], this.weth.address, componentData[i][1]);
      this.poolAddresses.push(poolAddress);
    }

    console.log(this.poolAddresses);
  }

  public async createSetToken(
    components: Address[],
    units: BigNumber[],
    modules: Address[],
    manager: Address = this._ownerAddress,
    name: string = "SetToken",
    symbol: string = "SET",
  ): Promise<SetToken> {
    const txHash: ContractTransaction = await this.factory.create(
      components,
      units,
      modules,
      manager,
      name,
      symbol,
    );

    const retrievedSetAddress = await new ProtocolUtils(this._provider).getCreatedSetTokenAddress(txHash.hash);

    return new SetToken__factory(this._ownerSigner).attach(retrievedSetAddress);
  }
}