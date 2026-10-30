class Api::V1::StatusesController < ApplicationController
  def index
    render json: []
  end

  def show
    render json: Status.find(params[:id])
  end

  def create
    @status = PostStatusService.new.call(current_account, text: params[:status])
    render json: @status
  end
end
