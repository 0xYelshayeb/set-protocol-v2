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

    console.log("Deploying Mock Tokens...");

    // create 10 tokens and approve them for issuanceModule

    for (let i = 0; i < 10; i++) {
      const token = await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(10000), 18, `token${i}`, `TOKEN${i}`);
      await token.approve(this.issuanceModule.address, ether(10000));
      this.components.push(token);
    }

    console.log("Mock Tokens deployed");

    this.weth = await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(50000), 18, "weth", "WETH");
    await this.weth.approve(this.issuanceModule.address, ether(10000));

    console.log("Approved tokens for issuanceModule");

    this.uniswapFactoryAddress = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
    this.uniswapRouterAddress = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
    this.uniswapNonFungiblePositionManagerAddress = "0x1238536071E1c677A632429e3655c799b22cDA52";

    for (let i = 0; i < 10; i++) {
      const poolAddress = await this.createUniswapPoolAndAddLiquidity(
        this._ownerSigner,
        this.uniswapFactoryAddress,
        this.uniswapNonFungiblePositionManagerAddress,
        this.components[i].address,
        this.weth.address,
      );
      this.poolAddresses.push(poolAddress.poolAddress);
    }
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

  public async createUniswapPoolAndAddLiquidity(
    signer: Signer,
    factoryAddress: Address,
    routerAddress: Address,
    tokenAAddress: Address,
    tokenBAddress: Address,
  ) {

    // sort addresses to create deterministic pair
    if (tokenAAddress.toLowerCase() > tokenBAddress.toLowerCase()) {
      const tempAddress = tokenAAddress;
      tokenAAddress = tokenBAddress;
      tokenBAddress = tempAddress;
    }

    console.log(`Creating pool for tokens: ${tokenAAddress} and ${tokenBAddress}`);

    // Connect to Uniswap Factory and Router contracts
    const factoryContract = new ethers.Contract(
      factoryAddress,
      [
        "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
        "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)"
      ],
      signer
    );

    // Connect to ERC20 token contracts
    const TokenA = ERC20__factory.connect(tokenAAddress, signer);
    const TokenB = ERC20__factory.connect(tokenBAddress, signer);

    // Approve the router to spend tokens
    const approve1 = await TokenA.approve(routerAddress, ether(10000));
    const approve2 = await TokenB.approve(routerAddress, ether(10000));

    await approve1.wait();
    await approve2.wait();

    const Router = new ethers.Contract(
      routerAddress,
      [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external",
        `function mint(
          (
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint256 amount0Desired,
            uint256 amount1Desired,
            uint256 amount0Min,
            uint256 amount1Min,
            address recipient,
            uint256 deadline
          )
        ) external returns (
          uint256 tokenId,
          uint128 liquidity,
          uint256 amount0,
          uint256 amount1
        )`
      ],
      signer
    );

    const tx2 = await Router.createAndInitializePoolIfNecessary(
      tokenAAddress,
      tokenBAddress,
      500,
      BigNumber.from("79228162514264337593543950336"),
    );

    await tx2.wait();

    // Add liquidity
    const params = {
      token0: tokenAAddress,
      token1: tokenBAddress,
      fee: 500,
      tickLower: -60,
      tickUpper: 60,
      amount0Desired: ether(1000),
      amount1Desired: ether(1000),
      amount0Min: ether(800),
      amount1Min: ether(800),
      recipient: await signer.getAddress(),
      deadline: Math.floor(Date.now() / 1000) + 86400000
    };

    const txOptions = {
      gasLimit: ethers.BigNumber.from("2000000"),
      value: ether(0)
    };

    console.log("Adding liquidity");

    const tx = await Router.mint(params, txOptions);

    await tx.wait();

    const poolAddress = await factoryContract.getPool(tokenAAddress, tokenBAddress, 500);
    console.log(poolAddress);

    return { poolAddress: poolAddress };
  }
}